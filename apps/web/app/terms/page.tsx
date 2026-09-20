import type { Metadata } from 'next';
import Link from 'next/link';
import { DocHeader } from '../components/DocHeader';

export const metadata: Metadata = {
  title: 'Terms of Service | Pulse Social Media',
};

export default function TermsPage() {
  return (
    <div className="content doc">
      <DocHeader />
      <h1>Terms of Service</h1>
      <p className="meta">Effective 10 September 2026 · Pulse Social Media · Product: Kip</p>

      <p>
        These Terms govern your use of Kip — the SMS and web product that drafts and publishes organic
        social content for your brand. By creating an account, texting Kip, or paying for a plan, you
        agree to them. If you use Kip for a company, you confirm you can bind that company.
      </p>

      <h2>1. The service</h2>
      <p>
        Kip helps you run organic posting to destinations you connect (Instagram, Facebook, X,
        Threads). Typical flow: you send a photo or instruction by SMS/MMS or in the web thread; Kip
        drafts a caption; you reply <strong>yes</strong> (or approve in the dashboard) before anything
        with outside impact posts — unless you explicitly enable autopilot. Kip may also run routines
        you set (check-ins, recaps, reminders) and keep brand memory you can edit.
      </p>
      <p>
        Kip is an organic social tool. It is not a paid-ads manager, CRM, or guarantee of reach,
        virality, or platform ranking.
      </p>

      <h2>2. Accounts &amp; access</h2>
      <ul>
        <li>
          You must provide an accurate mobile number and keep access to it. Login codes are sent by
          SMS.
        </li>
        <li>
          You are responsible for activity on your account and for anyone you invite (including
          operators you authorise).
        </li>
        <li>
          Pulse may provide break-glass operator access to help with setup or support; that access is
          logged and limited to delivering the service.
        </li>
      </ul>

      <h2>3. Approvals, autopilot &amp; platforms</h2>
      <ul>
        <li>
          <strong>Default:</strong> no publish with outside impact without a named yes from you or an
          authorised approver.
        </li>
        <li>
          <strong>Autopilot:</strong> if you turn it on, Kip may publish after a heads-up according to
          the rules you set. You can turn it off anytime.
        </li>
        <li>
          You must have rights to the media and captions you supply, and authority to post to
          connected accounts.
        </li>
        <li>
          You remain responsible for complying with Meta, X, Threads, and any other platform terms,
          community guidelines, and advertising/disclosure rules. Platforms may reject, rate-limit, or
          remove content; Kip is not liable for platform decisions.
        </li>
        <li>
          Disconnecting a destination stops future Kip publishes to it; it does not remove posts
          already live on that network.
        </li>
      </ul>

      <h2>4. AI drafting</h2>
      <p>
        Captions and suggestions are generated with third-party AI models from the inputs you provide.
        Output can be wrong, off-brand, or unsuitable. You (or your approver) are responsible for
        reviewing drafts before publish. Do not rely on Kip for legal, medical, or financial advice.
      </p>

      <h2>5. Plans, billing &amp; cancellation</h2>
      <ul>
        <li>
          Paid plans currently described as <strong>Pro</strong> and <strong>Max</strong>, billed
          monthly or annually (annual shown as a monthly equivalent with a 20% discount). Prices are
          in AUD and include GST.
        </li>
        <li>
          Features and limits on each plan are as shown at checkout and on the{' '}
          <Link href="/app/billing">Billing</Link> screen. We may change prices or packaging with
          notice for renewals.
        </li>
        <li>
          Cancel anytime via Billing; access continues through the paid period already billed.
          Annual plans are billed up front.
        </li>
        <li>
          If your first seven days are not useful, email{' '}
          <a href="mailto:will@jmcalder.com">will@jmcalder.com</a> within seven days of the first
          charge for a refund of that week. We process first-week refunds manually.
        </li>
        <li>
          If a renewal payment fails, Stripe retries the card and we keep access during those retries.
          If the subscription ends unpaid, dashboard access pauses until you update billing. We do
          not automatically pause SMS today.
        </li>
      </ul>

      <h2>6. Acceptable use</h2>
      <p>
        You will not use Kip to: spam; harass; infringe IP; post unlawful, hateful, or deceptive
        content; attempt to bypass platform or Kip safety limits; probe or disrupt our systems; or
        submit others’ personal data without a lawful basis. We may suspend accounts that break these
        rules or create legal or security risk.
      </p>

      <h2>7. Content ownership</h2>
      <p>
        You keep ownership of your media, captions, and memory files. You grant Pulse a limited
        licence to host, process, transmit, and publish that content solely to operate Kip for you. We
        may use de-identified, aggregated usage patterns to improve reliability (not to train
        generative models on your creative content).
      </p>

      <h2>8. Confidentiality &amp; privacy</h2>
      <p>
        How we handle personal data is described in the <Link href="/privacy">Privacy Policy</Link>.
        Deletion steps are in <Link href="/data-deletion">Data deletion</Link>.
      </p>

      <h2>9. Availability &amp; changes</h2>
      <p>
        We aim for reliable uptime but do not guarantee uninterrupted SMS delivery or platform API
        availability. We may modify features; we will not materially reduce core paid functionality
        without notice except for legal or security reasons.
      </p>

      <h2>10. Disclaimers &amp; liability</h2>
      <p>
        Kip is provided “as is” to the extent permitted by law. Nothing in these Terms excludes
        non-waivable Australian Consumer Law rights. To the maximum extent permitted, Pulse’s total
        liability for claims relating to Kip in any 12-month period is limited to the fees you paid us
        for Kip in that period. We are not liable for lost profits, lost posts, platform bans, or
        indirect damages.
      </p>

      <h2>11. Indemnity</h2>
      <p>
        You will indemnify Pulse against claims arising from your content, your connected accounts, or
        your misuse of Kip, except to the extent caused by our wilful misconduct.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These Terms are governed by the laws of Victoria, Australia. Courts there have exclusive
        jurisdiction, without limiting any non-waivable consumer rights where you live.
      </p>

      <h2>13. Contact</h2>
      <p>
        Pulse Social Media
        <br />
        <a href="mailto:will@jmcalder.com">will@jmcalder.com</a>
      </p>
    </div>
  );
}
