import {useQuery} from '@tanstack/react-query';
import type {BankConnectionAspsp, BankLogo as LogoMetadata} from '@tempo/contracts';
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

/** Original-colour artwork on one uniform bordered plate, shared with the picker's wide wordmark. */
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
    queryFn: () => api.get<LogoMetadata>(metadataUrl!),
    enabled: !!metadataUrl && visible,
    staleTime: 24 * 60 * 60_000,
    retry: false,
  });

  const [failed, setFailed] = useState<string>();
  const src = logo?.url ?? (!metadataUrl ? bank.logoUrl : undefined);
  // Current API URLs are relative to its base, including the production /api proxy path.
  const url = src && (src.startsWith('/') ? `${import.meta.env.VITE_API_URL}${src}` : src);
  return (
    <span
      ref={slot}
      className={cn(
        'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-bank-logo-edge bg-bank-logo-plate text-sm font-semibold text-bank-logo-ink',
        className,
      )}
      aria-hidden='true'
      data-testid={testId}
    >
      {url && src !== failed ? (
        <img
          key={url}
          src={url}
          alt=''
          className={cn('h-full w-full object-contain p-1', imageClassName)}
          loading='lazy'
          referrerPolicy='no-referrer'
          onError={() => setFailed(src)}
        />
      ) : bank.name ? (
        <span>{initials(bank.name)}</span>
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
