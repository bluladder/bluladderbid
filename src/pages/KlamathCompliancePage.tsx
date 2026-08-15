import {
  type KlamathCompliancePageRoute,
  type PublishedPublicContact,
  publicContactHref,
} from '@/lib/publicSite/klamathPublicSurface';
import {
  KLAMATH_MESSAGING_TERMS_REQUIRED_STATEMENTS,
  KLAMATH_OPT_IN_COPY,
  KLAMATH_PRIVACY_COPY,
  KLAMATH_TERMS_COPY,
} from '@/lib/publicSite/klamathComplianceCopy';

interface KlamathCompliancePageProps {
  route: KlamathCompliancePageRoute;
  pathPrefix?: '' | '/klamath';
  publicName: string;
  tagline: string;
  publicContactReady: boolean;
  publicContacts: PublishedPublicContact[];
}

const shellClass = 'mx-auto w-full max-w-3xl px-6 py-10 sm:py-14';
const sectionClass = 'space-y-3 rounded-xl border border-border bg-card p-6 shadow-sm';

function OptInContent() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Text messaging consent</h1>
      <section className={sectionClass}>
        <h2 className="text-xl font-semibold">How BluLadder Klamath obtains consent</h2>
        <p className="text-muted-foreground">
          {KLAMATH_OPT_IN_COPY.howConsentIsObtained}
        </p>
      </section>
      <section className={sectionClass}>
        <h2 className="text-xl font-semibold">Transactional messaging disclosure</h2>
        <p className="text-muted-foreground">
          {KLAMATH_OPT_IN_COPY.transactionalDisclosure}
        </p>
      </section>
      <section className={sectionClass}>
        <h2 className="text-xl font-semibold">No marketing opt-in</h2>
        <p className="text-muted-foreground">
          {KLAMATH_OPT_IN_COPY.marketingBoundary}
        </p>
      </section>
    </div>
  );
}

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
  const helpAndOptOutStatement = KLAMATH_MESSAGING_TERMS_REQUIRED_STATEMENTS[3];
  const [frequencyPrefix, frequencySuffix] =
    KLAMATH_TERMS_COPY.frequencyAndCarrierTerms.split(helpAndOptOutStatement);

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
          {frequencyPrefix}
          <strong className="font-semibold text-foreground">
            {helpAndOptOutStatement}
          </strong>
          {frequencySuffix}
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
        <h2 className="text-xl font-semibold">Text messaging support</h2>
        <p className="text-muted-foreground">
          For help with a BluLadder Klamath text message, reply HELP to that message. To stop
          messages, reply STOP. Message frequency varies and message and data rates may apply.
          A separate public phone or email support channel is not published yet. This page does
          not accept requests, collect information, or enable customer traffic.
        </p>
      </section>
    </div>
  );
}

export function KlamathCompliancePage({
  route,
  pathPrefix = '',
  publicName,
  tagline,
  publicContacts,
}: KlamathCompliancePageProps) {
  const pageHref = (page: '' | '/privacy' | '/terms' | '/contact') =>
    page === '' ? pathPrefix || '/privacy' : `${pathPrefix}${page}`;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <a href={pageHref('')} className="flex flex-col leading-none">
            <span className="font-display text-xl font-bold text-primary">{publicName}</span>
            <span className="text-xs text-muted-foreground">{tagline}</span>
          </a>
          <nav className="flex gap-4 text-sm" aria-label="Compliance pages">
            <a className="hover:text-primary" href={pageHref('/privacy')}>Privacy</a>
            <a className="hover:text-primary" href={pageHref('/terms')}>Terms</a>
            <a className="hover:text-primary" href={pageHref('/contact')}>Contact</a>
          </nav>
        </div>
      </header>
      <main className={shellClass}>
        {route === '/opt-in' ? <OptInContent /> : null}
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
