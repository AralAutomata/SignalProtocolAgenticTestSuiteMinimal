# Deno Test Overview Service

HTTP service for generating AI-powered test analysis reports using Deno.

## Endpoints

### POST /analyze
Generates a formal technical report from test data.

**Request:**
```json
{
  "totalRuns": 50,
  "runs": [...],
  "aggregates": {...}
}
```

**Response:**
```json
{
  "report": "EXECUTIVE SUMMARY\n• ..."
}
```

## Environment Variables
- `OPENAI_API_KEY` - OpenAI API key for report generation
- `PORT` - HTTP server port (default: 8000)

## Running
```bash
deno run --allow-net --allow-env main.ts
```

## Docker
```bash
docker build -t deno-test-overview .
docker run -e OPENAI_API_KEY=$OPENAI_API_KEY -p 8000:8000 deno-test-overview
```
