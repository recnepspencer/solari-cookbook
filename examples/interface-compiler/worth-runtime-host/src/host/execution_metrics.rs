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
        counters.record(&event)?;
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
    estimated_model_cost_microcents: u64,
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
            estimated_model_cost_microcents: integer("estimatedModelCostMicrocents"),
        }
    }

    fn record(&mut self, event: &serde_json::Value) -> Result<(), String> {
        match event.get("type").and_then(|value| value.as_str()) {
            Some("model.called") => {
                self.model_calls = self
                    .model_calls
                    .checked_add(1)
                    .ok_or("model call count overflowed")?;
                self.input_tokens = self
                    .input_tokens
                    .checked_add(measured_integer(event, "inputTokens"))
                    .ok_or("input token count overflowed")?;
                self.output_tokens = self
                    .output_tokens
                    .checked_add(measured_integer(event, "outputTokens"))
                    .ok_or("output token count overflowed")?;
                self.estimated_model_cost_microcents = self
                    .estimated_model_cost_microcents
                    .checked_add(
                        event
                            .pointer("/payload/estimatedModelCostMicrocents")
                            .and_then(|value| value.as_u64())
                            .unwrap_or(0),
                    )
                    .ok_or("estimated model cost overflowed")?;
            }
            Some("browser.observed") => {
                self.browser_observations = self
                    .browser_observations
                    .checked_add(1)
                    .ok_or("browser observation count overflowed")?
            }
            Some("browser.action") => {
                self.browser_actions = self
                    .browser_actions
                    .checked_add(1)
                    .ok_or("browser action count overflowed")?
            }
            _ => {}
        }
        Ok(())
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
            "estimatedModelCostMicrocents".into(),
            self.estimated_model_cost_microcents.into(),
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
