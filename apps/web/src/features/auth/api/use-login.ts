import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {api, HttpError} from '@/utils/api';
import {toast} from 'sonner';
import {LogInDto} from '../types/login-dto';

type LogInHttpError = HttpError & {
  status: 400 | 401;
};

const isLogInHttpError = (error: unknown): error is LogInHttpError => {
  return error instanceof HttpError && (error.status === 400 || error.status === 401);
};

/**
 * @throws {LogInHttpError}
 */
export const useLogIn = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<void, LogInHttpError, LogInDto>({
    mutationFn: async (logInDto: LogInDto) => {
      const user = await api.post('/auth/login', JSON.stringify(logInDto));
      await queryClient.setQueryData(['currentUser'], user.json());
      return navigate({to: '/dashboard'});
    },
    onError: (error) => {
      if (isLogInHttpError(error)) {
        throw error;
      } else {
        toast.error('There was a problem with your request.', {
          description: 'You could not be logged in. Please try again.',
        });
      }
    },
  });
};
