import {useEffect, useRef} from 'react';
import {Progress} from '@/components/ui/progress';
import {debounce, zxcvbnAsync, zxcvbnOptions} from '@zxcvbn-ts/core';
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common';
import * as zxcvbnEnPackage from '@zxcvbn-ts/language-en';
import {cn} from '@/lib/utils';

const options = {
  translations: zxcvbnEnPackage.translations,
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
};
zxcvbnOptions.setOptions(options);

export type PasswordStrengthIndicatorProps = {
  value: string;
  passwordStrength: number;
  setPasswordStrength: (strength: number) => void;
};

export function PasswordStrengthIndicator({
  value,
  passwordStrength,
  setPasswordStrength,
}: PasswordStrengthIndicatorProps) {
  const evaluatePasswordStrength = async (password: string) => {
    const result = await zxcvbnAsync(password);
    const calculatedStrength = result.score * 25;
    setPasswordStrength(Math.max(calculatedStrength, 25));
  };

  const debouncedEvaluatePasswordStrength = useRef(debounce(evaluatePasswordStrength, 200)).current;

  useEffect(() => {
    debouncedEvaluatePasswordStrength(value);
  }, [value, debouncedEvaluatePasswordStrength]);

  const strengthLevels = [
    {
      label: 'Too weak',
      progressBarColor: '[&>*]:bg-destructive',
      labelColor: 'text-destructive',
    },
    {
      label: 'Too weak',
      progressBarColor: '[&>*]:bg-destructive',
      labelColor: 'text-destructive',
    },
    {
      label: 'Fair',
      progressBarColor: '[&>*]:bg-amber-600',
      labelColor: 'text-amber-600',
    },
    {
      label: 'Good',
      progressBarColor: '[&>*]:bg-accent-foreground',
      labelColor: 'text-accent-foreground',
    },
    {
      label: 'Strong',
      progressBarColor: '[&>*]:bg-accent-foreground',
      labelColor: 'text-accent-foreground',
    },
  ];

  const getStrengthLevel = (strength: number) => {
    const index = Math.min(Math.floor(strength / 25), strengthLevels.length - 1);
    return strengthLevels[index];
  };

  const {label, progressBarColor, labelColor} = getStrengthLevel(passwordStrength);

  return (
    <>
      <p className={cn('text-sm font-medium', labelColor)}>{label}</p>
      <Progress
        value={passwordStrength}
        className={cn('mt-2 h-2 border-input border', progressBarColor)}
      />
    </>
  );
}
