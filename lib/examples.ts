import type { TrafficShape } from "./model/types";

export interface Example {
  id: string;
  label: string;
  emoji: string;
  description: string;
  shape: TrafficShape;
  baselineRps: number;
  peakRps: number;
  p99LatencyMs: number;
  availabilityPct: number;
}

export const EXAMPLES: Example[] = [
  {
    id: "ecommerce",
    label: "E-commerce API",
    emoji: "🛒",
    description:
      "A Node.js/Express REST API for an online store. PostgreSQL for orders and inventory, Redis for product and session caching, S3 for product images, and Stripe for payments. Background workers send emails and update search. Behind an application load balancer.",
    shape: "diurnal",
    baselineRps: 300,
    peakRps: 1200,
    p99LatencyMs: 400,
    availabilityPct: 99.95,
  },
  {
    id: "ai-chat",
    label: "AI chat app",
    emoji: "🤖",
    description:
      "A Next.js AI chat application. The API streams responses from the OpenAI API, stores conversation history in PostgreSQL, and uses Redis for rate limiting and session state. Embeddings are stored for retrieval.",
    shape: "spike",
    baselineRps: 50,
    peakRps: 500,
    p99LatencyMs: 2000,
    availabilityPct: 99.9,
  },
  {
    id: "saas-dashboard",
    label: "B2B SaaS dashboard",
    emoji: "📊",
    description:
      "A Python FastAPI backend powering a React analytics dashboard. PostgreSQL primary with heavy read queries, Redis cache, Elasticsearch for log search, and a Celery worker pool with RabbitMQ for report generation.",
    shape: "steady",
    baselineRps: 120,
    peakRps: 300,
    p99LatencyMs: 600,
    availabilityPct: 99.9,
  },
  {
    id: "social-feed",
    label: "Social feed",
    emoji: "📱",
    description:
      "A Go microservice serving a social media feed. MongoDB for posts, Redis for the timeline cache and fan-out, Kafka for the activity stream, and object storage for media. High read-to-write ratio.",
    shape: "diurnal",
    baselineRps: 2000,
    peakRps: 8000,
    p99LatencyMs: 250,
    availabilityPct: 99.99,
  },
];
