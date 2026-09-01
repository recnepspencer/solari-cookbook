//! WORTH-owned projection of measured execution telemetry.

use crate::application::InterfaceCompilerExecutionProjection;

pub(super) fn project_execution_metrics(
    projection: &InterfaceCompilerExecutionProjection,
    events_json: &str,
) -> Result<String, String> {
    let mut metrics: serde_json::Value = serde_json::from_str(&projection.start_metrics_json)
        .map_err(|_| "execution start metrics are malformed")?;
    let object = metrics
        .as_object_mut()
        .ok_or("execution start metrics are not an object")?;
    let events: Vec<serde_json::Value> =
        serde_json::from_str(events_json).map_err(|_| "execution event journal is malformed")?;
    let mut counters = ExecutionCounters::from_start_metrics(object);
    for event in events {
        counters.record(&event);
    }
    counters.write_to(object)?;
    project_terminal_timing(projection, object)?;
    serde_json::to_string(&metrics).map_err(|_| "execution metrics cannot be serialized".into())
}

struct ExecutionCounters {
    model_calls: u64,
    input_tokens: u64,
    output_tokens: u64,
    browser_observations: u64,
    browser_actions: u64,
    estimated_model_cost_usd: f64,
}

impl ExecutionCounters {
    fn from_start_metrics(metrics: &serde_json::Map<String, serde_json::Value>) -> Self {
        let integer = |field| {
            metrics
                .get(field)
                .and_then(|value| value.as_u64())
                .unwrap_or(0)
        };
        Self {
            model_calls: integer("modelCalls"),
            input_tokens: integer("inputTokens"),
            output_tokens: integer("outputTokens"),
            browser_observations: integer("browserObservations"),
            browser_actions: integer("browserActions"),
            estimated_model_cost_usd: metrics
                .get("estimatedModelCostUsd")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0),
        }
    }

    fn record(&mut self, event: &serde_json::Value) {
        match event.get("type").and_then(|value| value.as_str()) {
            Some("model.called") => {
                self.model_calls += 1;
                self.input_tokens += measured_integer(event, "inputTokens");
                self.output_tokens += measured_integer(event, "outputTokens");
                self.estimated_model_cost_usd += event
                    .pointer("/payload/estimatedModelCostUsd")
                    .and_then(|value| value.as_f64())
                    .unwrap_or(0.0);
            }
            Some("browser.observed") => self.browser_observations += 1,
            Some("browser.action") => self.browser_actions += 1,
            _ => {}
        }
    }

    fn write_to(
        self,
        metrics: &mut serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), String> {
        metrics.insert("modelCalls".into(), self.model_calls.into());
        metrics.insert("inputTokens".into(), self.input_tokens.into());
        metrics.insert("outputTokens".into(), self.output_tokens.into());
        metrics.insert(
            "browserObservations".into(),
            self.browser_observations.into(),
        );
        metrics.insert("browserActions".into(), self.browser_actions.into());
        metrics.insert(
            "estimatedModelCostUsd".into(),
            serde_json::Number::from_f64(self.estimated_model_cost_usd)
                .ok_or("execution cost is not finite")?
                .into(),
        );
        Ok(())
    }
}

fn measured_integer(event: &serde_json::Value, field: &str) -> u64 {
    event
        .pointer(&format!("/payload/{field}"))
        .and_then(|value| value.as_u64())
        .unwrap_or(0)
}

fn project_terminal_timing(
    projection: &InterfaceCompilerExecutionProjection,
    metrics: &mut serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let settlement: serde_json::Value =
        serde_json::from_str(&projection.settlement_json).unwrap_or(serde_json::Value::Null);
    let Some(ended_at) = settlement.get("endedAt").and_then(|value| value.as_str()) else {
        return Ok(());
    };
    let started_at = metrics
        .get("startedAt")
        .and_then(|value| value.as_str())
        .ok_or("execution startedAt is missing")?;
    let started = chrono::DateTime::parse_from_rfc3339(started_at)
        .map_err(|_| "execution startedAt is malformed")?;
    let ended = chrono::DateTime::parse_from_rfc3339(ended_at)
        .map_err(|_| "execution endedAt is malformed")?;
    let wall_clock = (ended - started).num_milliseconds();
    if wall_clock < 0 {
        return Err("execution endedAt precedes startedAt".into());
    }
    metrics.insert("endedAt".into(), ended_at.into());
    metrics.insert("wallClockMs".into(), wall_clock.into());
    Ok(())
}
