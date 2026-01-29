export type BridgeMethod =
  | 'ping'
  | 'listRequests'
  | 'getRequestDetails'
  | 'aggregateRequests'
  | 'addAnnotation'
  | 'listAnnotations'
  | 'replayRequest';

export interface BridgeRequest {
  id: string;
  method: BridgeMethod;
  params?: unknown;
  token: string;
}

export interface BridgeError {
  message: string;
  code?: string;
}

export interface BridgeResponse {
  id: string;
  result?: unknown;
  error?: BridgeError;
}
