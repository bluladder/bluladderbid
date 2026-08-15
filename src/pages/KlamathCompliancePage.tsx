import {
  type KlamathComplianceRoute,
  type PublishedPublicContact,
  publicContactHref,
} from '@/lib/publicSite/klamathPublicSurface';
import {
  KLAMATH_PRIVACY_COPY,
  KLAMATH_TERMS_COPY,
} from '@/lib/publicSite/klamathComplianceCopy';

interface KlamathCompliancePageProps {
  route: KlamathComplianceRoute;
  publicName: string;
  tagline: string;
  publicContactReady: boolean;
  publicContacts: PublishedPublicContact[];
}

const shellClass = 'mx-auto w-full max-w-3xl px-6 py-10 sm:py-14';
const sectionClass = 'space-y-3 rounded-xl border border-border bg-card p-6 shadow-sm';

function PrivacyContent() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <section className={sectionClass}>
        <h2 className="text-xl font-semibold">Information we use</h2>
        <p className="text-muted-foreground">
          {KLAMATH_PRIVACY_COPY.informationUse}
        </p>
      </section>
      <section className={sectionClass}>
        <h2 className="text-xl font-semibold">Mobile information</h2>
        <p className="text-muted-foreground">
          {KLAMATH_PRIVACY_COPY.mobileInformation}
        </p>
      </section>
      <section className={sectionClass}>
        <h2 className="text-xl font-semibold">Your choices</h2>
        <p className="text-muted-foreground">
          {KLAMATH_PRIVACY_COPY.choices}
        </p>
      </section>
    </div>
  );
}

function TermsContent() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Terms and Conditions</h1>
      <section className={sectionClass}>
        <h2 className="text-xl font-semibold">Messaging program</h2>
        <p className="text-muted-foreground">
          {KLAMATH_TERMS_COPY.messagingProgram}
        </p>
      </section>
      <section className={sectionClass}>
        <h2 className="text-xl font-semibold">Frequency and carrier terms</h2>
        <p className="text-muted-foreground">
          {KLAMATH_TERMS_COPY.frequencyAndCarrierTerms}
        </p>
      </section>
      <section className={sectionClass}>
        <h2 className="text-xl font-semibold">Consent</h2>
        <p className="text-muted-foreground">
          {KLAMATH_TERMS_COPY.consent}
        </p>
      </section>
    </div>
  );
}

function ContactContent({ contacts }: { contacts: PublishedPublicContact[] }) {
  if (contacts.length > 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Contact</h1>
        <section className={sectionClass}>
          <h2 className="text-xl font-semibold">Contact BluLadder Klamath</h2>
          <ul className="space-y-3">
            {contacts.map((contact) => (
              <li key={contact.channel}>
                <a className="font-medium text-primary underline-offset-4 hover:underline" href={publicContactHref(contact)}>
                  {contact.label}: {contact.value}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Contact</h1>
      <section className={sectionClass}>
        <h2 className="text-xl font-semibold">Support is not published yet</h2>
        <p className="text-muted-foreground">
          BluLadder Klamath is still preparing its public support channel. No request form, phone
          number, email address, quote, booking, message, or customer action is available on this
          page until the organization-scoped public contact is separately reviewed and published.
        </p>
      </section>
    </div>
  );
}

export function KlamathCompliancePage({
  route,
  publicName,
  tagline,
  publicContacts,
}: KlamathCompliancePageProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <a href="/privacy" className="flex flex-col leading-none">
            <span className="font-display text-xl font-bold text-primary">{publicName}</span>
            <span className="text-xs text-muted-foreground">{tagline}</span>
          </a>
          <nav className="flex gap-4 text-sm" aria-label="Compliance pages">
            <a className="hover:text-primary" href="/privacy">Privacy</a>
            <a className="hover:text-primary" href="/terms">Terms</a>
            <a className="hover:text-primary" href="/contact">Contact</a>
          </nav>
        </div>
      </header>
      <main className={shellClass}>
        {route === '/privacy' ? <PrivacyContent /> : null}
        {route === '/terms' ? <TermsContent /> : null}
        {route === '/contact' ? <ContactContent contacts={publicContacts} /> : null}
      </main>
      <footer className="border-t border-border">
        <p className="mx-auto w-full max-w-5xl px-6 py-8 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {publicName} • {tagline}
        </p>
      </footer>
    </div>
  );
}
