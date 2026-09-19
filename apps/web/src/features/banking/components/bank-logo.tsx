import {Building2} from 'lucide-react';
import {useState} from 'react';

import {cn} from '@/utils/cn';

import type {BankConnectionAspsp} from '../types/bank-connection';

type BankLogoProps = {
  bank: Pick<BankConnectionAspsp, 'name' | 'logoUrl'>;
  className?: string;
  testId?: string;
};

type LogoAnalysis = 'pending' | 'monochrome' | 'color' | 'unavailable';
type LogoAnalysisResult = Exclude<LogoAnalysis, 'pending'>;
type LogoAnalysisState = {url: string | null; value: LogoAnalysis};
type ImageState = {url: string | null; failed: boolean};

export function BankLogo({bank, className, testId = 'bank-logo'}: BankLogoProps) {
  const logoUrl = bank.logoUrl ?? null;
  const [imageState, setImageState] = useState<ImageState>(() => ({
    url: logoUrl,
    failed: false,
  }));
  const [analysisState, setAnalysisState] = useState<LogoAnalysisState>(() => ({
    url: logoUrl,
    value: logoUrl ? 'pending' : 'unavailable',
  }));
  const hasError = imageState.url === logoUrl && imageState.failed;
  const logoAnalysis =
    analysisState.url === logoUrl ? analysisState.value : logoUrl ? 'pending' : 'unavailable';

  const handleImageLoad = () => {
    if (!bank.logoUrl) return;

    const url = bank.logoUrl;
    setAnalysisState({url, value: 'pending'});
    void getLogoAnalysis(url).then((analysis) => {
      setAnalysisState((previous) => (previous.url === url ? {url, value: analysis} : previous));
    });
  };

  const handleImageError = () => {
    const url = bank.logoUrl ?? null;
    setImageState({url, failed: true});
    setAnalysisState({url, value: 'unavailable'});
  };

  return (
    <span
      className={cn(
        'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background text-sm font-semibold text-foreground shadow-sm',
        className,
      )}
      aria-hidden='true'
      data-logo-analysis={logoAnalysis}
      data-testid={testId}
    >
      {bank.logoUrl && !hasError ? (
        <img
          key={bank.logoUrl}
          src={bank.logoUrl}
          alt=''
          className={cn(
            'h-full w-full object-contain p-1',
            logoAnalysis === 'monochrome' && 'dark:brightness-0 dark:invert',
          )}
          loading='lazy'
          referrerPolicy='no-referrer'
          onLoad={handleImageLoad}
          onError={handleImageError}
        />
      ) : bank.name ? (
        <span>{bankInitials(bank.name)}</span>
      ) : (
        <Building2 className='h-4 w-4' />
      )}
    </span>
  );
}

const ANALYSIS_SIZE = 64;
const MAX_CHANNEL_DELTA = 0;
const MIN_VISIBLE_ALPHA = 16;
const ANIMATED_LOGO_URL_PATTERN = /\.(?:apng|gif|webp)(?:[?#]|$)/i;
const logoAnalysisInFlight = new Map<string, Promise<LogoAnalysisResult>>();

function getLogoAnalysis(url: string) {
  if (ANIMATED_LOGO_URL_PATTERN.test(url)) return Promise.resolve('unavailable' as const);

  const inFlightAnalysis = logoAnalysisInFlight.get(url);
  if (inFlightAnalysis) return inFlightAnalysis;

  const analysis = new Promise<LogoAnalysisResult>((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      image.onload = null;
      image.onerror = null;
      logoAnalysisInFlight.delete(url);
      resolve(classifyLogoImage(image));
    };
    image.onerror = () => {
      image.onload = null;
      image.onerror = null;
      logoAnalysisInFlight.delete(url);
      resolve('unavailable');
    };
    image.src = url;
  });

  logoAnalysisInFlight.set(url, analysis);
  return analysis;
}

function classifyLogoImage(image: HTMLImageElement): LogoAnalysisResult {
  const scale = Math.min(
    ANALYSIS_SIZE / image.naturalWidth,
    ANALYSIS_SIZE / image.naturalHeight,
    1,
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  try {
    const context = canvas.getContext('2d');
    if (!context) return 'unavailable';

    context.drawImage(image, 0, 0, width, height);
    const {data} = context.getImageData(0, 0, width, height);
    let visiblePixels = 0;
    let chromaticPixels = 0;

    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < MIN_VISIBLE_ALPHA) continue;

      visiblePixels += 1;
      const minimum = Math.min(data[index], data[index + 1], data[index + 2]);
      const maximum = Math.max(data[index], data[index + 1], data[index + 2]);
      if (maximum - minimum > MAX_CHANNEL_DELTA) chromaticPixels += 1;
    }

    if (visiblePixels === 0) return 'unavailable';
    return chromaticPixels === 0 ? 'monochrome' : 'color';
  } catch {
    return 'unavailable';
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function bankInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
  return (initials || name.slice(0, 2)).toUpperCase();
}
