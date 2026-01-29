import type { Annotation, RequestEvent, ResponseEvent, TimingEvent } from './types';
import type { HeaderMap } from '../types';

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

const assertHeaderMap = (headers: unknown, label: string): HeaderMap => {
  if (!isObject(headers)) {
    throw new Error(`${label} must be an object`);
  }
  return headers as HeaderMap;
};

export const assertRequestEvent = (event: RequestEvent): RequestEvent => {
  if (!event || !isString(event.id)) throw new Error('RequestEvent.id must be a string');
  if (!isString(event.timestamp)) throw new Error('RequestEvent.timestamp must be a string');
  if (!isString(event.scheme)) throw new Error('RequestEvent.scheme must be a string');
  if (!isString(event.host)) throw new Error('RequestEvent.host must be a string');
  if (!isString(event.method)) throw new Error('RequestEvent.method must be a string');
  if (!isString(event.path)) throw new Error('RequestEvent.path must be a string');
  if (!isString(event.query)) throw new Error('RequestEvent.query must be a string');
  if (!isNumber(event.size)) throw new Error('RequestEvent.size must be a number');
  assertHeaderMap(event.headers, 'RequestEvent.headers');
  return event;
};

export const assertResponseEvent = (event: ResponseEvent): ResponseEvent => {
  if (!event || !isString(event.request_id)) throw new Error('ResponseEvent.request_id must be a string');
  if (!isString(event.timestamp)) throw new Error('ResponseEvent.timestamp must be a string');
  if (event.status !== null && !isNumber(event.status)) throw new Error('ResponseEvent.status must be a number or null');
  if (!isNumber(event.size)) throw new Error('ResponseEvent.size must be a number');
  assertHeaderMap(event.headers, 'ResponseEvent.headers');
  return event;
};

export const assertTimingEvent = (event: TimingEvent): TimingEvent => {
  if (!event || !isString(event.request_id)) throw new Error('TimingEvent.request_id must be a string');
  if (!isNumber(event.start)) throw new Error('TimingEvent.start must be a number');
  if (!isNumber(event.end)) throw new Error('TimingEvent.end must be a number');
  if (!isNumber(event.duration)) throw new Error('TimingEvent.duration must be a number');
  return event;
};

export const assertAnnotation = (annotation: Annotation): Annotation => {
  if (!annotation || !isString(annotation.request_id)) throw new Error('Annotation.request_id must be a string');
  if (!Array.isArray(annotation.tags)) throw new Error('Annotation.tags must be an array');
  if (!isString(annotation.note)) throw new Error('Annotation.note must be a string');
  if (!isString(annotation.created_at)) throw new Error('Annotation.created_at must be a string');
  return annotation;
};
