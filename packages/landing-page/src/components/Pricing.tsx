import React from 'react';

interface Plan {
  name: string;
  description: string;
  price: string;
  priceSuffix: string;
  highlighted?: boolean;
  cta: string;
  ctaHref: string;
  features: string[];
}

const plans: Plan[] = [
  {
    name: 'Starter',
    description: 'For small construction companies with 1-3 active sites.',
    price: '$249',
    priceSuffix: '/site / month',
    cta: 'Start free trial',
    ctaHref: '#contact',
    features: [
      'Up to 100 workers',
      'Up to 3 sites',
      'Worker access validation (QR / SMS gate)',
      'Certification management & expiry tracking',
      'Daily compliance summaries',
      'Email support',
    ],
  },
  {
    name: 'Professional',
    description: 'For mid-size companies needing AI safety observation.',
    price: '$699',
    priceSuffix: '/site / month',
    highlighted: true,
    cta: 'Start free trial',
    ctaHref: '#contact',
    features: [
      'Up to 500 workers',
      'Up to 10 sites',
      'Everything in Starter',
      'AI safety observation pipeline',
      // #2: lean on our zero-marginal-cost inference advantage — competitors
      // paying per-token can't match generous included analysis volume.
      'Generous AI photo analysis included — no per-image fees',
      'Finding review workflow',
      'Enforcement actions & escalation',
      'PDF/CSV report exports',
      'Priority support',
    ],
  },
  {
    name: 'Enterprise',
    description: 'For large organizations with custom compliance needs.',
    price: 'Custom',
    priceSuffix: 'flat-fee · unlimited users',
    cta: 'Talk to sales',
    ctaHref: '#contact',
    features: [
      'Unlimited workers & sites',
      'Unlimited users (no per-seat charges)',
      'Everything in Professional',
      'Custom policy configurations',
      'Multi-tenant management',
      'API access & integrations',
      'Dedicated account manager',
      'SLA guarantees',
    ],
  },
];

export const Pricing: React.FC = () => {
  return (
    <section id="pricing" className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Plans for Every Size of Operation
          </h2>
          <p className="mt-4 max-w-2xl mx-auto text-lg text-gray-600">
            Simple per-site pricing. No per-user fees, no per-image AI charges.
            Start free — no credit card required.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative p-8 rounded-xl border ${
                plan.highlighted
                  ? 'border-primary-500 bg-white shadow-xl ring-2 ring-primary-500'
                  : 'border-gray-200 bg-white'
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center px-4 py-1 rounded-full text-sm font-semibold bg-primary-600 text-white">
                    Most Popular
                  </span>
                </div>
              )}
              <h3 className="text-2xl font-bold text-gray-900">{plan.name}</h3>
              <p className="mt-2 text-gray-600">{plan.description}</p>
              <div className="mt-6 flex items-baseline gap-2 flex-wrap">
                <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                <span className="text-gray-500">{plan.priceSuffix}</span>
              </div>
              <ul className="mt-8 space-y-3" role="list">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <svg
                      className="w-5 h-5 text-accent-500 flex-shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>
              <a
                href={plan.ctaHref}
                className={`mt-8 block w-full text-center px-6 py-3 rounded-lg font-semibold transition-colors ${
                  plan.highlighted
                    ? 'bg-primary-600 text-white hover:bg-primary-700'
                    : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                }`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-gray-500">
          Prices in CAD, billed monthly. Annual billing saves 2 months.
          14-day free trial on Starter &amp; Professional.
        </p>
      </div>
    </section>
  );
};
