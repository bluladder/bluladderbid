import { Link, useSearchParams } from 'react-router-dom';
import { Sparkles, Droplets, Home, TreeDeciduous, Sun, ArrowRight } from 'lucide-react';

const SERVICES = [
  {
    slug: 'window-cleaning',
    title: 'Window Cleaning',
    description: 'Crystal clear views inside and out. Professional cleaning for all window types.',
    icon: Sparkles,
    color: 'from-sky-500 to-cyan-400',
    bgLight: 'bg-sky-50',
    iconColor: 'text-sky-500',
  },
  {
    slug: 'gutter-cleaning',
    title: 'Gutter Cleaning',
    description: 'Protect your home from water damage with thorough gutter and downspout cleaning.',
    icon: Home,
    color: 'from-amber-500 to-orange-400',
    bgLight: 'bg-amber-50',
    iconColor: 'text-amber-500',
  },
  {
    slug: 'house-wash',
    title: 'House Washing',
    description: 'Restore your home\'s curb appeal with our safe soft wash technique.',
    icon: Droplets,
    color: 'from-emerald-500 to-teal-400',
    bgLight: 'bg-emerald-50',
    iconColor: 'text-emerald-500',
  },
  {
    slug: 'roof-cleaning',
    title: 'Roof Cleaning',
    description: 'Remove algae, moss, and debris to extend your roof\'s lifespan.',
    icon: TreeDeciduous,
    color: 'from-slate-600 to-zinc-500',
    bgLight: 'bg-slate-50',
    iconColor: 'text-slate-600',
  },
  {
    slug: 'driveway-cleaning',
    title: 'Driveway Cleaning',
    description: 'Make your driveway look brand new with professional pressure washing.',
    icon: Sun,
    color: 'from-violet-500 to-purple-400',
    bgLight: 'bg-violet-50',
    iconColor: 'text-violet-500',
  },
  {
    slug: 'pressure-washing',
    title: 'Pressure Washing',
    description: 'Power away dirt and grime from patios, decks, walkways, and more.',
    icon: Droplets,
    color: 'from-blue-500 to-indigo-400',
    bgLight: 'bg-blue-50',
    iconColor: 'text-blue-500',
  },
];

const Services = () => {
  const [searchParams] = useSearchParams();
  const isEmbedMode = searchParams.get('embed') === 'true';

  return (
    <div className="min-h-screen bg-background">
      {/* Header - hidden in embed mode */}
      {!isEmbedMode && (
        <header className="border-b border-border bg-card sticky top-0 z-50">
          <div className="container py-4">
            <div className="flex items-center justify-between">
              <Link to="/" className="hover:opacity-80 transition-opacity">
                <h1 className="text-xl font-display font-bold text-primary">
                  BluLadder
                </h1>
                <p className="text-xs text-muted-foreground">Next Level Clean</p>
              </Link>
              <Link 
                to="/" 
                className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                Get a Quote →
              </Link>
            </div>
          </div>
        </header>
      )}

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
              const Icon = service.icon;
              return (
                <Link
                  key={service.slug}
                  to={`/${service.slug}${isEmbedMode ? '?embed=true' : ''}`}
                  className="group relative overflow-hidden rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-lg transition-all duration-300"
                >
                  {/* Gradient accent bar */}
                  <div className={`h-1.5 bg-gradient-to-r ${service.color}`} />
                  
                  <div className="p-6 space-y-4">
                    {/* Icon */}
                    <div className={`w-14 h-14 rounded-xl ${service.bgLight} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                      <Icon className={`w-7 h-7 ${service.iconColor}`} />
                    </div>
                    
                    {/* Content */}
                    <div className="space-y-2">
                      <h2 className="text-xl font-semibold text-foreground group-hover:text-primary transition-colors">
                        {service.title}
                      </h2>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {service.description}
                      </p>
                    </div>
                    
                    {/* CTA */}
                    <div className="flex items-center gap-2 text-sm font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity duration-300">
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
                to={isEmbedMode ? '/?embed=true' : '/'}
                className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
              >
                Build Your Bundle
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer - hidden in embed mode */}
      {!isEmbedMode && (
        <footer className="border-t border-border mt-8">
          <div className="container py-6 text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} BluLadder • Next Level Clean
          </div>
        </footer>
      )}
    </div>
  );
};

export default Services;
