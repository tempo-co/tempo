export class HttpError extends Error {
  constructor(public status: number) {
    super();
    this.status = status;
  }
}

const API_BASE_URL = import.meta.env.VITE_API_URL;

const request = async (resource: string, init?: RequestInit): Promise<Response> => {
  const url = `${API_BASE_URL}${resource}`;

  const defaultHeaders = {
    'Content-Type': 'application/json',
  };
  const headers = {...defaultHeaders, ...init?.headers};

  const response = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    throw new HttpError(response.status);
  }
  return response;
};

const get = (resource: string, init?: RequestInit): Promise<Response> => {
  return request(resource, {...init, method: 'GET'});
};

const post = (resource: string, body?: BodyInit, init?: RequestInit): Promise<Response> => {
  return request(resource, {...init, method: 'POST', body});
};

const put = (resource: string, body?: BodyInit, init?: RequestInit): Promise<Response> => {
  return request(resource, {...init, method: 'PUT', body});
};

const patch = (resource: string, body?: BodyInit, init?: RequestInit): Promise<Response> => {
  return request(resource, {...init, method: 'PATCH', body});
};

const _delete = (resource: string, init?: RequestInit | null): Promise<Response> => {
  return request(resource, {...init, method: 'DELETE'});
};

export const api = {
  get,
  post,
  put,
  patch,
  delete: _delete,
};
