import React from 'react';

const testimonials = [
  {
    quote:
      'SiteMacaron transformed how we manage compliance across our 12 active sites. The AI safety observations catch things our manual inspections miss.',
    author: 'Sarah',
    role: 'VP of Safety',
    company: 'Builders',
  },
  {
    quote:
      'The explainability feature is a game-changer for WorkSafeBC audits. Every decision has a clear paper trail with policy references.',
    author: 'Marcus',
    role: 'Chief Safety Officer',
    company: 'Construction',
  },
  {
    quote:
      'Morning gate access went from a 5-minute bottleneck to instant QR scans. Workers love the simplicity, and we love the compliance data.',
    author: 'Raj',
    role: 'Site Administrator',
    company: '',
  },
];

export const Testimonials: React.FC = () => {
  return (
    <section id="testimonials" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Trusted by BC Construction Leaders
          </h2>
          <p className="mt-4 max-w-2xl mx-auto text-lg text-gray-600">
            See how construction companies across British Columbia are using SiteMacaron to streamline compliance.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
          {testimonials.map((testimonial) => (
            <div
              key={testimonial.author}
              className="p-8 bg-gray-50 rounded-xl border border-gray-100"
            >
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <svg
                    key={i}
                    className="w-5 h-5 text-yellow-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              <blockquote className="text-gray-700 leading-relaxed">
                &ldquo;{testimonial.quote}&rdquo;
              </blockquote>
              <div className="mt-6 border-t border-gray-200 pt-4">
                <p className="font-semibold text-gray-900">{testimonial.author}</p>
                <p className="text-sm text-gray-500">
                  {testimonial.role}, {testimonial.company}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
