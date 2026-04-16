export interface EvalRequest {
  query: string;
  response: string;
}

export interface EvalCriteria {
  factually_accurate: boolean;
  relevant_to_query: boolean;
  concise: boolean;
  helpful: boolean;
}

export interface EvalResult {
  score: number;
  pass: boolean;
  reasoning: string;
  criteria: EvalCriteria;
  langsmith_run_id?: string;
  langsmith_url?: string;
}
