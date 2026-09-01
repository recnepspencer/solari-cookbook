//! Aggregation facade for the Interface Compiler WORTH application contract.

mod execution_query;
mod schema;

pub use execution_query::execution_read_query_definition;
pub use schema::*;
