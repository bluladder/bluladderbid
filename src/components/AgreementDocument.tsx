import { PackageTier, BusinessDetails, AgreementTerms, FREQUENCY_TEXT } from '@/types/servicePlan';
import { forwardRef } from 'react';

interface AgreementDocumentProps {
  pkg: PackageTier;
  businessDetails: BusinessDetails;
  terms: AgreementTerms;
  customerName: string;
  customerAddress: string;
  pricingDisplayMode?: 'monthly' | 'deposit';
}

export const AgreementDocument = forwardRef<HTMLDivElement, AgreementDocumentProps>(
  ({ pkg, businessDetails, terms, customerName, customerAddress, pricingDisplayMode = 'deposit' }, ref) => {
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const effectiveCustomerName = customerName || '[Customer Name]';
    const effectiveCustomerAddress = customerAddress || '[Address on file]';

    return (
      <div
        ref={ref}
        className="bg-card border border-border rounded-lg p-8 md:p-10 max-w-3xl mx-auto shadow-card"
      >
        {/* Header */}
        <div className="text-center border-b border-border pb-6 mb-8">
          {businessDetails.logo && (
            <div className="flex justify-center mb-4">
              <img
                src={businessDetails.logo}
                alt={businessDetails.businessName}
                className="h-14 object-contain"
              />
            </div>
          )}
          <h1 className="font-display text-2xl font-bold text-foreground mb-2">
            Service Agreement
          </h1>
          <p className="text-lg text-muted-foreground">{businessDetails.businessName}</p>
          {(businessDetails.phone || businessDetails.email) && (
            <p className="text-sm text-muted-foreground mt-1">
              {businessDetails.phone}{businessDetails.phone && businessDetails.email && ' • '}{businessDetails.email}
            </p>
          )}
          {businessDetails.serviceArea && (
            <p className="text-sm text-muted-foreground mt-1">
              Serving {businessDetails.serviceArea}
            </p>
          )}
        </div>

        {/* Plan Badge */}
        <div className="flex justify-center mb-8">
          <div
            className={`px-5 py-2 rounded-lg font-display font-bold ${
              pkg.tier === 'good'
                ? 'bg-tier-good text-white'
                : pkg.tier === 'better'
                ? 'bg-tier-better text-primary-foreground'
                : 'bg-tier-best text-success-foreground'
            }`}
          >
            {pkg.name} Plan
          </div>
        </div>

        {/* Parties */}
        <Section title="Agreement Overview">
          <p>
            This Membership Service Agreement ("Agreement") is entered into as of{' '}
            <strong>{today}</strong> between:
          </p>
          <div className="mt-4 grid md:grid-cols-2 gap-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Service Provider
              </p>
              <p className="font-semibold text-foreground">{businessDetails.businessName}</p>
              {businessDetails.ownerName && <p className="text-sm text-muted-foreground">{businessDetails.ownerName}</p>}
              {businessDetails.phone && <p className="text-sm text-muted-foreground">{businessDetails.phone}</p>}
              {businessDetails.email && <p className="text-sm text-muted-foreground">{businessDetails.email}</p>}
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Customer
              </p>
              <p className="font-semibold text-foreground">{effectiveCustomerName}</p>
              <p className="text-sm text-muted-foreground">{effectiveCustomerAddress}</p>
            </div>
          </div>
        </Section>

        {/* Plan Overview */}
        <Section title="1. Plan Overview">
          <p className="mb-4">
            Customer agrees to enroll in the <strong>{pkg.name} Plan</strong>, which includes the
            following services performed at the frequencies indicated:
          </p>
          <ul className="space-y-2">
            {pkg.services.map((service) => (
              <li key={service.id} className="flex items-start gap-2">
                <span className="text-accent font-bold">•</span>
                <span>
                  <strong>{service.name}</strong> — {FREQUENCY_TEXT[service.frequency]}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {/* Pricing & Payment */}
        <Section title="2. Pricing & Payment Terms">
          <div className="bg-muted/50 rounded-lg p-4 mb-4">
            {pricingDisplayMode === 'deposit' ? (
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Deposit</p>
                  <p className="font-display text-2xl font-bold text-foreground">
                    ${pkg.depositAmount.toFixed(0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">11 Payments</p>
                  <p className="font-display text-2xl font-bold text-accent">
                    ${((pkg.annualTotal - pkg.depositAmount) / 11).toFixed(0)}/mo
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Annual Total</p>
                  <p className="font-display text-2xl font-bold text-foreground">
                    ${pkg.annualTotal.toFixed(0)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Monthly Rate</p>
                  <p className="font-display text-2xl font-bold text-accent">
                    ${pkg.monthlyPrice.toFixed(0)}/mo
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Annual Total</p>
                  <p className="font-display text-2xl font-bold text-foreground">
                    ${pkg.annualTotal.toFixed(0)}
                  </p>
                </div>
              </div>
            )}
            {pkg.savings > 0 && (
              <div className="mt-4 pt-4 border-t border-border text-center">
                <p className="text-sm font-semibold text-success">
                  🎉 Member Savings: ${pkg.savings.toFixed(0)} ({pkg.savingsPercent}% off retail pricing)
                </p>
              </div>
            )}
          </div>
          {pricingDisplayMode === 'deposit' ? (
            <p className="mb-2">
              <strong>Payment Structure:</strong> An initial deposit of ${pkg.depositAmount.toFixed(0)}{' '}
              is due at signup. The remaining balance of ${(pkg.annualTotal - pkg.depositAmount).toFixed(0)}{' '}
              will be divided into 11 equal monthly payments of{' '}
              ${((pkg.annualTotal - pkg.depositAmount) / 11).toFixed(0)}.
            </p>
          ) : (
            <p className="mb-2">
              <strong>Payment Structure:</strong> A flat monthly rate of ${pkg.monthlyPrice.toFixed(0)}{' '}
              will be billed each month for the duration of the membership term.
            </p>
          )}
          <p className="mb-2">
            <strong>Pay-in-Full Option:</strong> Customers who pay the full annual amount upfront
            receive a discounted rate of ${pkg.payInFullPrice.toFixed(0)}{' '}
            {pkg.payInFullSavings > 0 && (
              <span className="text-success font-medium">
                (saving an additional ${pkg.payInFullSavings.toFixed(0)})
              </span>
            )}.
          </p>
          {(pkg.savings > 0 || pkg.payInFullSavings > 0) && (
            <div className="mt-4 p-3 rounded-lg bg-success/10 border border-success/20">
              <p className="text-sm font-semibold text-success text-center">
                💰 Total Potential Savings: ${(pkg.savings + pkg.payInFullSavings).toFixed(0)} with Pay-in-Full
              </p>
            </div>
          )}
        </Section>

        {/* Membership Length */}
        <Section title="3. Membership Term">
          <p>
            This membership is valid for <strong>{terms.membershipLength} months</strong> from the
            date of enrollment. At the end of the term, the membership may be renewed at the
            then-current rates.
          </p>
        </Section>

        {/* Perks */}
        {pkg.perks.length > 0 && (
          <Section title="4. Member Benefits & Guarantees">
            <p className="mb-3">As a {pkg.name} Plan member, you receive the following benefits:</p>
            <ul className="space-y-2">
              {pkg.perks.map((perk) => (
                <li key={perk.id} className="flex items-start gap-2">
                  <span className="text-success font-bold">✓</span>
                  <span>
                    <strong>{perk.name}</strong> — {perk.description}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Scheduling & Access */}
        <Section title="5. Scheduling & Property Access">
          <p className="mb-3">{terms.accessPolicy}</p>
          <p>{terms.weatherPolicy}</p>
        </Section>

        {/* Customer Responsibilities */}
        <Section title="6. Customer Responsibilities">
          <p>{terms.customerResponsibilities}</p>
        </Section>

        {/* Cancellation */}
        <Section title="7. Cancellation & Early Termination">
          <p className="mb-3">{terms.cancellationNotice}</p>
          <p>{terms.refundPolicy}</p>
        </Section>

        {/* Touch-ups */}
        <Section title="8. Touch-Up Policy">
          <p>{terms.touchUpPolicy}</p>
        </Section>

        {/* Service Limitations */}
        <Section title="9. Service Limitations">
          <p>{terms.serviceLimitations}</p>
        </Section>

        {/* Acknowledgement */}
        <Section title="10. Agreement Acknowledgement">
          <p className="mb-6">
            By signing below, both parties agree to the terms and conditions outlined in this
            Membership Service Agreement.
          </p>
          <div className="grid md:grid-cols-2 gap-8 avoid-break" style={{ pageBreakInside: 'avoid' }}>
            <SignatureLine label="Customer Signature" name={effectiveCustomerName} />
            <SignatureLine
              label="Provider Signature"
              name={businessDetails.ownerName || businessDetails.businessName}
            />
          </div>
        </Section>

        {/* License Statement */}
        {businessDetails.licenseStatement && (
          <div className="mt-8 pt-6 border-t border-border text-center avoid-break" style={{ pageBreakInside: 'avoid' }}>
            <p className="text-sm text-muted-foreground">{businessDetails.licenseStatement}</p>
          </div>
        )}

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-warning/10 border border-warning/20 rounded-lg avoid-break" style={{ pageBreakInside: 'avoid' }}>
          <p className="text-xs text-muted-foreground text-center">
            <strong>Disclaimer:</strong> This agreement template is provided for convenience and is
            not legal advice. Consult a local attorney to ensure compliance with your state and
            local laws.
          </p>
        </div>
      </div>
    );
  }
);

AgreementDocument.displayName = 'AgreementDocument';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8 avoid-break" style={{ pageBreakInside: 'avoid' }}>
      <h2 className="font-display text-lg font-semibold text-foreground mb-3">{title}</h2>
      <div className="text-foreground/90 leading-relaxed">{children}</div>
    </div>
  );
}

function SignatureLine({ label, name }: { label: string; name: string }) {
  return (
    <div>
      <div className="border-b border-foreground/30 mb-2 h-12" />
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm text-foreground">{name}</p>
      <p className="text-xs text-muted-foreground mt-1">Date: _____________</p>
    </div>
  );
}
