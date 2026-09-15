import { TextKipCta } from './TextKipCta';
import { kipSmsComposeHref } from '@/lib/kip-sms';

export function HeroTextKip({ className }: { className?: string }) {
  return <TextKipCta smsHref={kipSmsComposeHref()} className={className} />;
}
