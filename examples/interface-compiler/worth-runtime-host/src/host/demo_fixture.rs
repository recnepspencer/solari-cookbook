//! Checked-in fixture payloads for the in-memory Enron Online demonstration.

pub(super) struct DemoReplaySeed {
    pub capability_id: &'static str,
    pub capability_name: &'static str,
    pub capability_description: &'static str,
    pub replay_id: &'static str,
    pub steps_json: String,
    pub verification_json: &'static str,
}

pub(super) fn replays_for_base_url(base_url: &str) -> [DemoReplaySeed; 1] {
    [DemoReplaySeed {
        capability_id: super::DEMO_CAPABILITY_ID,
        capability_name: "TradesIngestIncomingTrade",
        capability_description: "Ingest a delivered trade email into Financials and verify its receipt.",
        replay_id: super::DEMO_REPLAY_ID,
        steps_json: replace_portal_origin(include_str!("../../fixtures/enron-online/ingest-incoming-trade.steps.json"), base_url),
        verification_json: include_str!("../../fixtures/enron-online/ingest-incoming-trade.verification.json"),
    }]
}

fn replace_portal_origin(fixture: &str, base_url: &str) -> String {
    fixture.replace(super::DEMO_APPLICATION_BASE_URL, base_url)
}

pub(super) const EXECUTION_START_METRICS_JSON: &str =
    include_str!("../../fixtures/enron-online/execution-start-metrics.json");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_in_demo_payloads_are_valid_json() {
        for seed in replays_for_base_url(crate::host::DEMO_APPLICATION_BASE_URL) {
            serde_json::from_str::<serde_json::Value>(&seed.steps_json)
                .expect("demo replay steps fixture must be JSON");
            serde_json::from_str::<serde_json::Value>(seed.verification_json)
                .expect("demo replay verification fixture must be JSON");
        }
        serde_json::from_str::<serde_json::Value>(EXECUTION_START_METRICS_JSON)
            .expect("demo execution metrics fixture must be JSON");
    }
}
