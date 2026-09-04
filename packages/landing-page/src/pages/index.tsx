import React from 'react';
import { Hero } from '../components/Hero';
import { Features } from '../components/Features';
import { Pricing } from '../components/Pricing';
import { Testimonials } from '../components/Testimonials';
import { ContactForm } from '../components/ContactForm';
import { Footer } from '../components/Footer';

export const IndexPage: React.FC = () => {
  return (
    <main>
      <Hero />
      <Features />
      <Pricing />
      <Testimonials />
      <ContactForm />
      <Footer />
    </main>
  );
};
