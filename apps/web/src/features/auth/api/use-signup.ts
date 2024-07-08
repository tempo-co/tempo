import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {api, HttpError} from '@/utils/api';
import {toast} from 'sonner';
import {SignUpDto} from '../types/signup-dto';

type SignUpHttpError = HttpError & {
  status: 400 | 409;
};

const isSignUpHttpError = (error: unknown): error is SignUpHttpError => {
  return error instanceof HttpError && (error.status === 400 || error.status === 409);
};

/**
 * @throws {SignUpHttpError}
 */
export const useSignUp = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {mutate: signUp, isPending} = useMutation<void, SignUpHttpError, SignUpDto>({
    mutationFn: async (signUpDto: SignUpDto) => {
      const user = await api.post('/auth/signup', JSON.stringify(signUpDto));
      await queryClient.setQueryData(['currentUser'], user.json());
      return navigate({to: '/dashboard'});
    },
    onError: (error) => {
      if (isSignUpHttpError(error)) {
        throw error;
      } else {
        toast.error('There was a problem with your request.', {
          description: 'Your account could not be created. Please try again.',
        });
      }
    },
  });
  return {signUp, isPending};
};
