import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { CustomerHeader } from '@/components/CustomerHeader';
import { CustomerFooter } from '@/components/CustomerFooter';
import windowImg from '@/assets/services/window-cleaning.jpg.asset.json';
import gutterImg from '@/assets/services/gutter-cleaning.jpeg.asset.json';
import houseImg from '@/assets/services/house-wash.webp.asset.json';
import roofImg from '@/assets/services/roof-cleaning.png.asset.json';
import drivewayImg from '@/assets/services/driveway-cleaning.png.asset.json';
import pressureImg from '@/assets/services/pressure-washing.jpeg.asset.json';

const SERVICES = [
  {
    slug: 'window-cleaning',
    title: 'Window Cleaning',
    description: 'Crystal clear views inside and out. Professional cleaning for all window types.',
    image: windowImg.url,
  },
  {
    slug: 'gutter-cleaning',
    title: 'Gutter Cleaning',
    description: 'Protect your home from water damage with thorough gutter and downspout cleaning.',
    image: gutterImg.url,
  },
  {
    slug: 'house-wash',
    title: 'House Washing',
    description: 'Restore your home\'s curb appeal with our safe soft wash technique.',
    image: houseImg.url,
  },
  {
    slug: 'roof-cleaning',
    title: 'Roof Cleaning',
    description: 'Remove algae, moss, and debris to extend your roof\'s lifespan.',
    image: roofImg.url,
  },
  {
    slug: 'driveway-cleaning',
    title: 'Driveway Cleaning',
    description: 'Make your driveway look brand new with professional pressure washing.',
    image: drivewayImg.url,
  },
  {
    slug: 'pressure-washing',
    title: 'Pressure Washing',
    description: 'Power away dirt and grime from patios, decks, walkways, and more.',
    image: pressureImg.url,
  },
];

const Services = () => {
  const [searchParams] = useSearchParams();
  const embedParam = searchParams.get('embed');
  const isEmbedMode = embedParam === 'true' || embedParam === '1';

  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader embed={isEmbedMode} />

      {/* Hero Section */}
      <div className="bg-gradient-to-br from-primary/10 via-background to-primary/5 py-16">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center space-y-4">
            <h1 className="text-4xl md:text-5xl font-display font-bold text-foreground">
              Our <span className="text-primary">Services</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Professional exterior cleaning services to keep your home looking its best. 
              Click any service to get instant pricing.
            </p>
          </div>
        </div>
      </div>

      {/* Services Grid */}
      <main className="container py-12">
        <div className="max-w-5xl mx-auto">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((service) => {
              return (
                <Link
                  key={service.slug}
                  to={`/${service.slug}${isEmbedMode ? `?embed=${embedParam}` : ''}`}
                  className="group relative overflow-hidden rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-xl transition-all duration-300 min-h-[280px] flex flex-col justify-end"
                >
                  {/* Background photo */}
                  <img
                    src={service.image}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 opacity-60 group-hover:opacity-75"
                  />
                  {/* Light wash — brightens photo and gives bold text solid legibility */}
                  <div className="absolute inset-0 bg-white/55 group-hover:bg-white/40 transition-colors" aria-hidden="true" />
                  {/* Subtle bottom gradient so descender text stays crisp */}
                  <div className="absolute inset-0 bg-gradient-to-t from-white/60 via-white/20 to-transparent" aria-hidden="true" />

                  {/* Content */}
                  <div className="relative p-6 space-y-2">
                    <h2 className="text-2xl font-display font-bold text-primary">
                      {service.title}
                    </h2>
                    <p className="text-sm font-medium text-foreground/90 line-clamp-2">
                      {service.description}
                    </p>
                    <div className="flex items-center gap-2 text-sm font-bold text-primary pt-1">
                      <span>Get Pricing</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Bottom CTA */}
          <div className="mt-12 text-center">
            <div className="inline-flex flex-col sm:flex-row items-center gap-4 p-6 rounded-2xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
              <div className="text-left">
                <p className="font-semibold text-foreground">Need multiple services?</p>
                <p className="text-sm text-muted-foreground">Bundle and save with our service plans.</p>
              </div>
              <Link
                to={isEmbedMode ? `/?embed=${embedParam}` : '/'}
                className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
              >
                Build Your Bundle
              </Link>
            </div>
          </div>
        </div>
      </main>

      <CustomerFooter embed={isEmbedMode} />
    </div>
  );
};

export default Services;
