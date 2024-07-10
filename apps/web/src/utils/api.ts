export class HttpError extends Error {
  constructor(public status: number) {
    super();
    this.status = status;
  }
}

const API_BASE_URL = import.meta.env.VITE_API_URL;

const request = async (resource: string, init?: RequestInit) => {
  const url = API_BASE_URL + resource;

  const headers = {'Content-Type': 'application/json', ...init?.headers};

  const response = await fetch(url, {headers, credentials: 'include', ...init});
  if (!response.ok) {
    throw new HttpError(response.status);
  }
  return response;
};

const get = (resource: string, init?: RequestInit) => {
  return request(resource, {...init, method: 'GET'});
};

const post = (resource: string, body?: BodyInit, init?: RequestInit) => {
  return request(resource, {...init, method: 'POST', body});
};

const put = (resource: string, body?: BodyInit, init?: RequestInit) => {
  return request(resource, {...init, method: 'PUT', body});
};

const patch = (resource: string, body?: BodyInit, init?: RequestInit) => {
  return request(resource, {...init, method: 'PATCH', body});
};

const _delete = (resource: string, init?: RequestInit | null) => {
  return request(resource, {...init, method: 'DELETE'});
};

export const api = {get, post, put, patch, delete: _delete};
