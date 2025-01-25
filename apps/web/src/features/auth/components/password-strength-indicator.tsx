import {debounce, zxcvbnAsync, zxcvbnOptions} from '@zxcvbn-ts/core';
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common';
import * as zxcvbnEnPackage from '@zxcvbn-ts/language-en';
import {CircleAlert, TriangleAlert} from 'lucide-react';
import {useEffect} from 'react';

import {Button} from '@/components/ui/button';
import {Progress} from '@/components/ui/progress';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/utils/cn';

const options = {
  translations: zxcvbnEnPackage.translations,
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: {...zxcvbnCommonPackage.dictionary, ...zxcvbnEnPackage.dictionary},
};
zxcvbnOptions.setOptions(options);

const MIN_STRENGTH = 25;
const STRENGTH_STEP = 25;

type PasswordStrengthIndicatorProps = {
  value: string;
  passwordStrength: number;
  setPasswordStrength: (strength: number) => void;
};

export function PasswordStrengthIndicator({
  value,
  passwordStrength,
  setPasswordStrength,
}: PasswordStrengthIndicatorProps) {
  useEffect(() => {
    const calculateStrength = async (password: string) => {
      const result = await zxcvbnAsync(password);
      const strength = Math.max(result.score * STRENGTH_STEP, MIN_STRENGTH);
      setPasswordStrength(strength);
    };

    const debouncedCalculateStrength = debounce(calculateStrength, 200);
    debouncedCalculateStrength(value);
  }, [value, setPasswordStrength]);

  const strengthLevels = [
    {label: 'Too weak', progressBarColor: '[&>*]:bg-destructive', labelColor: 'text-destructive'},
    {label: 'Fair', progressBarColor: '[&>*]:bg-warning', labelColor: 'text-warning'},
    {label: 'Good', progressBarColor: '[&>*]:bg-success', labelColor: 'text-success'},
    {label: 'Strong', progressBarColor: '[&>*]:bg-success', labelColor: 'text-success'},
  ];

  const getStrengthLevel = (strength: number) => {
    const index = Math.min(Math.floor(strength / STRENGTH_STEP), strengthLevels.length);
    if (index === 0) {
      return strengthLevels[index];
    }
    return strengthLevels[index - 1];
  };

  const {label, progressBarColor, labelColor} = getStrengthLevel(passwordStrength);

  return (
    <>
      <div className='flex items-center justify-between'>
        <p className={cn('text-sm font-medium', labelColor)}>{label}</p>
        {passwordStrength <= 50 && (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='h-6 w-6 hover:text-foreground'
                >
                  {passwordStrength === 25 && <CircleAlert className='w-4 text-destructive' />}
                  {passwordStrength === 50 && <TriangleAlert className='w-4 text-warning' />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {passwordStrength === 25 && (
                  <>
                    <p className='mb-1'>This password is too weak.</p>
                    <p>Try a longer mix of characters, and avoid common</p>
                    <p>words, repeating characters or patterns.</p>
                  </>
                )}
                {passwordStrength === 50 && (
                  <>
                    <p className='mb-1'>This password will work, but could be stronger.</p>
                    <p>Consider a longer mix of characters, and avoid</p>
                    <p>common words, repeating characters or patterns.</p>
                  </>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <Progress
        value={passwordStrength}
        className={cn('h-2 border border-input', progressBarColor)}
      />
    </>
  );
}
