import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, ExternalLink, Code, Link2, Frame, Share2 } from 'lucide-react';
import { toast } from 'sonner';

const BASE_URL = 'https://bluladderbid.lovable.app';

const SERVICE_PAGES = [
  { slug: '', label: 'Main Quote Page', description: 'Full service selector with all options' },
  { slug: 'window-cleaning', label: 'Window Cleaning', description: 'Pre-selects window cleaning service' },
  { slug: 'gutter-cleaning', label: 'Gutter Cleaning', description: 'Pre-selects gutter cleaning service' },
  { slug: 'house-wash', label: 'House Wash', description: 'Pre-selects house washing service' },
  { slug: 'roof-cleaning', label: 'Roof Cleaning', description: 'Pre-selects roof cleaning service' },
  { slug: 'driveway-cleaning', label: 'Driveway Cleaning', description: 'Pre-selects driveway cleaning' },
  { slug: 'pressure-washing', label: 'Pressure Washing', description: 'Pre-selects pressure washing' },
];

export function EmbedCodeManager() {
  const [selectedPage, setSelectedPage] = useState('');
  const [embedWidth, setEmbedWidth] = useState('100%');
  const [embedHeight, setEmbedHeight] = useState('800');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const pageConfig = SERVICE_PAGES.find(p => p.slug === selectedPage) || SERVICE_PAGES[0];
  const pagePath = selectedPage ? `/${selectedPage}` : '/';
  
  // URLs
  const directUrl = `${BASE_URL}${pagePath}`;
  const embedUrl = `${BASE_URL}${pagePath}?embed=true`;

  // Generate embed codes
  const iframeCode = `<iframe 
  src="${embedUrl}"
  width="${embedWidth}"
  height="${embedHeight}px"
  frameborder="0"
  style="border: none; border-radius: 8px;"
  title="BluLadder Quote Calculator"
  loading="lazy"
></iframe>`;

  const buttonLinkCode = `<a 
  href="${directUrl}"
  target="_blank"
  rel="noopener noreferrer"
  style="display: inline-block; padding: 12px 24px; background: #3B82F6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;"
>
  Get a Free Quote
</a>`;

  const widgetScriptCode = `<!-- BluLadder Quote Widget -->
<div id="bluladder-quote-widget"></div>
<script>
(function() {
  var container = document.getElementById('bluladder-quote-widget');
  var iframe = document.createElement('iframe');
  iframe.src = '${embedUrl}';
  iframe.style.width = '${embedWidth}';
  iframe.style.height = '${embedHeight}px';
  iframe.style.border = 'none';
  iframe.style.borderRadius = '8px';
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('title', 'BluLadder Quote Calculator');
  container.appendChild(iframe);
})();
</script>`;

  const copyToClipboard = async (text: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      toast.success('Copied to clipboard!');
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const CopyButton = ({ text, fieldId }: { text: string; fieldId: string }) => (
    <Button
      variant="outline"
      size="sm"
      onClick={() => copyToClipboard(text, fieldId)}
      className="shrink-0"
    >
      {copiedField === fieldId ? (
        <><Check className="w-4 h-4 mr-1" /> Copied</>
      ) : (
        <><Copy className="w-4 h-4 mr-1" /> Copy</>
      )}
    </Button>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="w-5 h-5" />
            Website Integration Tools
          </CardTitle>
          <CardDescription>
            Generate embed codes, links, and widgets to integrate the quote calculator into your website, 
            landing pages, or marketing materials.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Page Selector */}
          <div className="space-y-2">
            <Label>Select Quote Page</Label>
            <Select value={selectedPage} onValueChange={setSelectedPage}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a page to embed" />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_PAGES.map(page => (
                  <SelectItem key={page.slug} value={page.slug}>
                    <div className="flex flex-col">
                      <span>{page.label}</span>
                      <span className="text-xs text-muted-foreground">{page.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Selected: <Badge variant="secondary">{pageConfig.label}</Badge>
            </p>
          </div>

          {/* Size Controls */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="embed-width">Width</Label>
              <Input
                id="embed-width"
                value={embedWidth}
                onChange={(e) => setEmbedWidth(e.target.value)}
                placeholder="100% or 600px"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="embed-height">Height (px)</Label>
              <Input
                id="embed-height"
                type="number"
                value={embedHeight}
                onChange={(e) => setEmbedHeight(e.target.value)}
                placeholder="800"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Embed Options */}
      <Tabs defaultValue="direct-link" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="direct-link" className="flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            <span className="hidden sm:inline">Direct Link</span>
          </TabsTrigger>
          <TabsTrigger value="iframe" className="flex items-center gap-2">
            <Frame className="w-4 h-4" />
            <span className="hidden sm:inline">iFrame</span>
          </TabsTrigger>
          <TabsTrigger value="button" className="flex items-center gap-2">
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Button</span>
          </TabsTrigger>
          <TabsTrigger value="widget" className="flex items-center gap-2">
            <Code className="w-4 h-4" />
            <span className="hidden sm:inline">Widget</span>
          </TabsTrigger>
        </TabsList>

        {/* Direct Link */}
        <TabsContent value="direct-link">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Link2 className="w-5 h-5 text-primary" />
                Direct Link
              </CardTitle>
              <CardDescription>
                Share this link on social media, in emails, blog posts, or anywhere you want to 
                direct customers to get a quote.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input value={directUrl} readOnly className="font-mono text-sm" />
                <CopyButton text={directUrl} fieldId="direct-link" />
                <Button variant="outline" size="sm" asChild>
                  <a href={directUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </Button>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium">Best for:</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>Social media posts (Facebook, Instagram, etc.)</li>
                  <li>Email marketing campaigns</li>
                  <li>Blog post call-to-actions</li>
                  <li>QR codes for print materials</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* iFrame Embed */}
        <TabsContent value="iframe">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Frame className="w-5 h-5 text-primary" />
                iFrame Embed
              </CardTitle>
              <CardDescription>
                Embed the quote calculator directly into any webpage. The header and footer are 
                automatically hidden for a seamless integration.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>HTML Code</Label>
                  <CopyButton text={iframeCode} fieldId="iframe" />
                </div>
                <Textarea 
                  value={iframeCode} 
                  readOnly 
                  className="font-mono text-xs h-40"
                />
              </div>
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium">Best for:</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>Website service pages</li>
                  <li>Landing pages for ad campaigns</li>
                  <li>WordPress, Squarespace, Wix sites</li>
                  <li>Any HTML page with embed support</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Button Link */}
        <TabsContent value="button">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Share2 className="w-5 h-5 text-primary" />
                Button Link
              </CardTitle>
              <CardDescription>
                Add a styled "Get a Quote" button to your website that opens the calculator 
                in a new tab.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>HTML Code</Label>
                  <CopyButton text={buttonLinkCode} fieldId="button" />
                </div>
                <Textarea 
                  value={buttonLinkCode} 
                  readOnly 
                  className="font-mono text-xs h-32"
                />
              </div>
              <div className="space-y-2">
                <Label>Preview</Label>
                <div className="border rounded-lg p-6 bg-card flex justify-center">
                  <a 
                    href={directUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity"
                  >
                    Get a Free Quote
                  </a>
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium">Best for:</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>Hero sections on your homepage</li>
                  <li>Service page call-to-actions</li>
                  <li>Navigation menu items</li>
                  <li>Email templates</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Widget Script */}
        <TabsContent value="widget">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                JavaScript Widget
              </CardTitle>
              <CardDescription>
                A self-contained widget script that creates the embed automatically. 
                Just paste where you want it to appear.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>Widget Code</Label>
                  <CopyButton text={widgetScriptCode} fieldId="widget" />
                </div>
                <Textarea 
                  value={widgetScriptCode} 
                  readOnly 
                  className="font-mono text-xs h-48"
                />
              </div>
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium">Best for:</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>Sites where you can't easily add iframes</li>
                  <li>CMS platforms with script support</li>
                  <li>Dynamic page builders</li>
                  <li>WordPress with custom HTML blocks</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Quick Reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Available Service Landing Pages</CardTitle>
          <CardDescription>
            Each service has a dedicated landing page that pre-selects that service for a more 
            focused customer experience.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {SERVICE_PAGES.map(page => (
              <div 
                key={page.slug} 
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
              >
                <div>
                  <p className="font-medium text-sm">{page.label}</p>
                  <p className="text-xs text-muted-foreground">{page.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-2 py-1 rounded">
                    {page.slug ? `/${page.slug}` : '/'}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(
                      `${BASE_URL}${page.slug ? `/${page.slug}` : '/'}`,
                      `page-${page.slug}`
                    )}
                  >
                    {copiedField === `page-${page.slug}` ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
