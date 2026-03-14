#!/bin/sh
set -e

ARGS="--port ${LOGGER_PORT:-514} --api-url ${API_URL:-http://api:3001} --no-color"

if [ -n "$LOGGER_WORKSPACE_ID" ] && [ -n "$OPENAI_API_KEY" ]; then
  echo "Ingestion enabled: workspace=$LOGGER_WORKSPACE_ID"
  ARGS="$ARGS --workspace-id $LOGGER_WORKSPACE_ID --openai-key $OPENAI_API_KEY"
  [ -n "$LOGGER_BATCH_SIZE" ]      && ARGS="$ARGS --batch-size $LOGGER_BATCH_SIZE"
  [ -n "$LOGGER_FLUSH_INTERVAL" ]  && ARGS="$ARGS --flush-interval $LOGGER_FLUSH_INTERVAL"
  [ -n "$LOGGER_LLM_MODEL" ]       && ARGS="$ARGS --llm-model $LOGGER_LLM_MODEL"
  [ -n "$LOGGER_MAX_PENDING" ]     && ARGS="$ARGS --max-pending $LOGGER_MAX_PENDING"
else
  echo "Listen-only mode (set LOGGER_WORKSPACE_ID + OPENAI_API_KEY to enable ingestion)"
fi

exec python main.py $ARGS
