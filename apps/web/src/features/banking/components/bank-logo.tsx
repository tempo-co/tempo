import {useQuery} from '@tanstack/react-query';
import type {BankConnectionAspsp, BankLogoVariant, BankLogo as ThemedLogo} from '@tempo/contracts';
import {Building2} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

import {api} from '@/utils/api';
import {cn} from '@/utils/cn';

export type BankArtwork = Pick<BankConnectionAspsp, 'logoUrl' | 'logo'>;
type BankLogoProps = {
  bank: BankArtwork & {name: string};
  className?: string;
  imageClassName?: string;
  testId?: string;
};

/** BankLogo and the picker's wide wordmark share the API's original-colour variants and plate decisions. */
export function BankLogo({bank, className, imageClassName, testId = 'bank-logo'}: BankLogoProps) {
  const metadataUrl = bank.logo?.metadataUrl;
  const slot = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!metadataUrl || visible || !slot.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(slot.current);
    return () => observer.disconnect();
  }, [metadataUrl, visible]);
  const {data: logo} = useQuery({
    queryKey: ['bank-logo', metadataUrl],
    queryFn: () => api.get<ThemedLogo>(metadataUrl!),
    enabled: !!metadataUrl && visible,
    staleTime: 24 * 60 * 60_000,
    retry: false,
  });

  return (
    <span
      ref={slot}
      className={cn(
        'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md text-sm font-semibold',
        className,
      )}
      aria-hidden='true'
      data-testid={testId}
    >
      {logo ? (
        <>
          <Artwork
            name={bank.name}
            variant={logo.light}
            theme='light'
            className='flex dark:hidden'
            imageClassName={imageClassName}
          />
          <Artwork
            name={bank.name}
            variant={logo.dark}
            theme='dark'
            className='hidden dark:flex'
            imageClassName={imageClassName}
          />
        </>
      ) : (
        <Artwork
          name={bank.name}
          variant={!metadataUrl && bank.logoUrl ? {url: bank.logoUrl, plate: false} : undefined}
          className='flex'
          imageClassName={imageClassName}
        />
      )}
    </span>
  );
}

function Artwork({
  name,
  variant,
  theme,
  className,
  imageClassName,
}: {
  name: string;
  variant?: BankLogoVariant;
  theme?: 'light' | 'dark';
  className: string;
  imageClassName?: string;
}) {
  const [failed, setFailed] = useState<string>();
  const src = variant?.url && variant.url !== failed ? variant.url : undefined;
  // Current API URLs are relative to its base, including the production /api proxy path.
  const url = src && (src.startsWith('/') ? `${import.meta.env.VITE_API_URL}${src}` : src);
  return (
    <span
      className={cn(
        'h-full w-full items-center justify-center overflow-hidden rounded-[inherit]',
        className,
        !src &&
          'border border-transaction-tile-edge bg-transaction-tile-field text-transaction-tile-ink',
        src && variant?.plate && 'border border-transaction-tile-edge bg-bank-logo-plate',
      )}
      data-logo-theme={theme}
      data-logo-plate={!!src && !!variant?.plate}
    >
      {url ? (
        <img
          key={url}
          src={url}
          alt=''
          className={cn('h-full w-full object-contain p-1', imageClassName)}
          loading='lazy'
          referrerPolicy='no-referrer'
          onError={() => setFailed(src)}
        />
      ) : name ? (
        <span>{initials(name)}</span>
      ) : (
        <Building2 className='h-4 w-4' />
      )}
    </span>
  );
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0])
      .join('') || name.slice(0, 2)
  ).toUpperCase();
}
