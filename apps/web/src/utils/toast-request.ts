import {toast} from 'sonner';

import {wasToasted} from '@/utils/api';

type ToastRequestMessages<T> = {
  loading: string;
  success: string | ((data: T) => string | Promise<string>);
  error: string;
};

/**
 * Like `toast.promise` for an API request, except that a failure the api wrapper already toasted
 * closes the loading toast instead of adding a second error. Rejects with the request's error.
 */
export async function toastRequest<T>(request: Promise<T>, messages: ToastRequestMessages<T>) {
  const id = toast.loading(messages.loading);
  let data: T;
  try {
    data = await request;
  } catch (error) {
    if (wasToasted(error)) toast.dismiss(id);
    else toast.error(messages.error, {id});
    throw error;
  }
  const {success} = messages;
  try {
    toast.success(typeof success === 'function' ? await success(data) : success, {id});
  } catch (error) {
    toast.dismiss(id);
    throw error;
  }
  return data;
}
