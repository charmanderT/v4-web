export type LoadablePending<T> = { status: 'pending'; data?: T };
export type LoadableSuccess<T> = { status: 'success'; data: T };
export type LoadableIdle = { status: 'idle'; data: undefined };
export type LoadableError<T> = { status: 'error'; data?: T; error: any };
export type Loadable<T> = LoadableIdle | LoadableSuccess<T> | LoadablePending<T> | LoadableError<T>;

export function loadablePending<T>() {
  return { status: 'pending' } as LoadablePending<T>;
}

export function loadableIdle() {
  return { status: 'idle', data: undefined } as const;
}

export function loadableLoaded<T>(value: T) {
  return { status: 'success', data: value } as const;
}

export function isLoadableSuccess<T>(obj: Loadable<T>): obj is LoadableSuccess<T> {
  return obj.status === 'success';
}

export function isLoadableError<T>(obj: Loadable<T>): obj is LoadableError<T> {
  return obj.status === 'error';
}

export function isLoadablePending<T>(obj: Loadable<T>): obj is LoadablePending<T> {
  return obj.status === 'pending';
}

export function isLoadableIdle<T>(obj: Loadable<T>): obj is LoadableIdle {
  return obj.status === 'idle';
}
