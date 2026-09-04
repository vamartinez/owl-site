import React from 'react';

export const Hero: React.FC = () => {
  return (
    <section className="relative min-h-screen flex items-center bg-gradient-to-br from-primary-900 via-primary-800 to-primary-950 overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-20 left-10 w-72 h-72 bg-accent-400 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-primary-400 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight">
            AI-Powered Compliance
            <span className="block text-accent-400">for BC Construction Sites</span>
          </h1>
          <p className="mt-6 max-w-2xl mx-auto text-lg sm:text-xl text-primary-100">
            Automate worker access validation, safety inspections, and regulatory compliance.
            Every decision is explainable, auditable, and aligned with WorkSafeBC regulations —
            with generous AI photo analysis included and no per-image fees.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="#pricing"
              className="inline-flex items-center justify-center px-8 py-3 text-base font-semibold rounded-lg text-primary-900 bg-accent-400 hover:bg-accent-300 transition-colors"
            >
              Start free trial
            </a>
            <a
              href="#contact"
              className="inline-flex items-center justify-center px-8 py-3 text-base font-semibold rounded-lg text-white border-2 border-primary-300 hover:bg-primary-700 transition-colors"
            >
              Request a Demo
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};
