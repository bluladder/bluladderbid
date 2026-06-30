import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Home as HomeIcon, BellRing, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MessagePreferencesCard } from '@/components/customer/MessagePreferencesCard';

export default function MessagePreferences() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [activeEmail, setActiveEmail] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email && !activeEmail) {
      setEmail(user.email);
      setActiveEmail(user.email);
    }
  }, [user, activeEmail]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (trimmed) setActiveEmail(trimmed);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-display font-bold text-primary">Notification Preferences</h1>
              <p className="text-xs text-muted-foreground">Manage your texts and emails from BluLadder</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">
                <HomeIcon className="w-4 h-4 mr-2" />
                Home
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-2xl mx-auto">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="w-5 h-5" /> Find Your Preferences
            </CardTitle>
            <CardDescription>
              Enter the email you used when booking or requesting a quote to manage how we reach you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="pref-email-lookup" className="sr-only">Email address</Label>
                <Input
                  id="pref-email-lookup"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                />
              </div>
              <Button type="submit">
                <Search className="w-4 h-4 mr-2" /> Manage
              </Button>
            </form>
          </CardContent>
        </Card>

        {activeEmail && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preferences for {activeEmail}</CardTitle>
              <CardDescription>
                Turning a channel off pauses those messages for you only — you can turn it back on anytime.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MessagePreferencesCard email={activeEmail} bare />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
