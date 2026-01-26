import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Copy, Check, ExternalLink, Code, Link2, Frame, Share2, Target, ChevronDown, Eye, RefreshCw } from 'lucide-react';
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

const UTM_PRESETS = [
  { label: 'Google Ads', source: 'google', medium: 'cpc', campaign: '' },
  { label: 'Facebook Ads', source: 'facebook', medium: 'paid_social', campaign: '' },
  { label: 'Instagram', source: 'instagram', medium: 'social', campaign: '' },
  { label: 'Email Newsletter', source: 'newsletter', medium: 'email', campaign: '' },
  { label: 'Blog Post', source: 'blog', medium: 'content', campaign: '' },
  { label: 'Partner Website', source: 'partner', medium: 'referral', campaign: '' },
];

interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
}

export function EmbedCodeManager() {
  const [selectedPage, setSelectedPage] = useState('');
  const [embedWidth, setEmbedWidth] = useState('100%');
  const [embedHeight, setEmbedHeight] = useState('800');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [utmOpen, setUtmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [utm, setUtm] = useState<UtmParams>({
    source: '',
    medium: '',
    campaign: '',
    term: '',
    content: '',
  });

  const pageConfig = SERVICE_PAGES.find(p => p.slug === selectedPage) || SERVICE_PAGES[0];
  const pagePath = selectedPage ? `/${selectedPage}` : '/';

  // Build UTM query string
  const utmQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (utm.source) params.set('utm_source', utm.source);
    if (utm.medium) params.set('utm_medium', utm.medium);
    if (utm.campaign) params.set('utm_campaign', utm.campaign);
    if (utm.term) params.set('utm_term', utm.term);
    if (utm.content) params.set('utm_content', utm.content);
    return params.toString();
  }, [utm]);

  const hasUtmParams = utmQueryString.length > 0;
  
  // URLs with UTM parameters
  const directUrl = useMemo(() => {
    const base = `${BASE_URL}${pagePath}`;
    return hasUtmParams ? `${base}?${utmQueryString}` : base;
  }, [pagePath, utmQueryString, hasUtmParams]);

  const embedUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('embed', 'true');
    if (utm.source) params.set('utm_source', utm.source);
    if (utm.medium) params.set('utm_medium', utm.medium);
    if (utm.campaign) params.set('utm_campaign', utm.campaign);
    if (utm.term) params.set('utm_term', utm.term);
    if (utm.content) params.set('utm_content', utm.content);
    return `${BASE_URL}${pagePath}?${params.toString()}`;
  }, [pagePath, utm]);

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

  const applyUtmPreset = (preset: typeof UTM_PRESETS[0]) => {
    setUtm(prev => ({
      ...prev,
      source: preset.source,
      medium: preset.medium,
      campaign: preset.campaign || prev.campaign,
    }));
  };

  const clearUtmParams = () => {
    setUtm({ source: '', medium: '', campaign: '', term: '', content: '' });
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

      {/* UTM Parameter Builder */}
      <Card>
        <Collapsible open={utmOpen} onOpenChange={setUtmOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5" />
                  <div>
                    <CardTitle className="text-base">Campaign Tracking (UTM Parameters)</CardTitle>
                    <CardDescription>
                      Add tracking parameters to measure which embeds drive conversions
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasUtmParams && (
                    <Badge variant="secondary" className="text-xs">
                      {Object.values(utm).filter(Boolean).length} params set
                    </Badge>
                  )}
                  <ChevronDown className={`w-4 h-4 transition-transform ${utmOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              {/* Quick Presets */}
              <div className="space-y-2">
                <Label className="text-sm">Quick Presets</Label>
                <div className="flex flex-wrap gap-2">
                  {UTM_PRESETS.map(preset => (
                    <Button
                      key={preset.label}
                      variant="outline"
                      size="sm"
                      onClick={() => applyUtmPreset(preset)}
                      className="text-xs"
                    >
                      {preset.label}
                    </Button>
                  ))}
                  {hasUtmParams && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearUtmParams}
                      className="text-xs text-muted-foreground"
                    >
                      Clear All
                    </Button>
                  )}
                </div>
              </div>

              {/* UTM Fields */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="utm-source" className="text-sm">
                    Source <span className="text-muted-foreground">(required)</span>
                  </Label>
                  <Input
                    id="utm-source"
                    value={utm.source}
                    onChange={(e) => setUtm(p => ({ ...p, source: e.target.value }))}
                    placeholder="e.g., google, facebook"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="utm-medium" className="text-sm">
                    Medium <span className="text-muted-foreground">(required)</span>
                  </Label>
                  <Input
                    id="utm-medium"
                    value={utm.medium}
                    onChange={(e) => setUtm(p => ({ ...p, medium: e.target.value }))}
                    placeholder="e.g., cpc, email, social"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="utm-campaign" className="text-sm">Campaign</Label>
                  <Input
                    id="utm-campaign"
                    value={utm.campaign}
                    onChange={(e) => setUtm(p => ({ ...p, campaign: e.target.value }))}
                    placeholder="e.g., spring_sale_2026"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="utm-term" className="text-sm">Term</Label>
                  <Input
                    id="utm-term"
                    value={utm.term}
                    onChange={(e) => setUtm(p => ({ ...p, term: e.target.value }))}
                    placeholder="e.g., window+cleaning"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="utm-content" className="text-sm">Content</Label>
                  <Input
                    id="utm-content"
                    value={utm.content}
                    onChange={(e) => setUtm(p => ({ ...p, content: e.target.value }))}
                    placeholder="e.g., hero_button"
                  />
                </div>
              </div>

              {/* Preview */}
              {hasUtmParams && (
                <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                  <Label className="text-sm">URL Preview</Label>
                  <code className="text-xs break-all block text-muted-foreground">
                    {directUrl}
                  </code>
                </div>
              )}

              {/* Help Text */}
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>utm_source:</strong> Where traffic comes from (e.g., google, newsletter)</p>
                <p><strong>utm_medium:</strong> Marketing medium (e.g., cpc, email, social)</p>
                <p><strong>utm_campaign:</strong> Campaign name for grouping (e.g., spring_promo)</p>
                <p><strong>utm_term:</strong> Paid search keywords</p>
                <p><strong>utm_content:</strong> Differentiate similar links (e.g., sidebar_cta)</p>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Live Preview Panel */}
      <Card>
        <Collapsible open={previewOpen} onOpenChange={setPreviewOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-5 h-5" />
                  <div>
                    <CardTitle className="text-base">Live Preview</CardTitle>
                    <CardDescription>
                      See how the embedded calculator will look at your configured dimensions
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {embedWidth} × {embedHeight}px
                  </Badge>
                  <ChevronDown className={`w-4 h-4 transition-transform ${previewOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Previewing: <Badge variant="outline">{pageConfig.label}</Badge>
                  {hasUtmParams && <span className="ml-2">with UTM tracking</span>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewKey(k => k + 1)}
                >
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Refresh
                </Button>
              </div>
              
              {/* Preview Container */}
              <div 
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg bg-muted/20 overflow-hidden"
                style={{ 
                  maxWidth: embedWidth.includes('%') ? '100%' : embedWidth,
                  margin: '0 auto'
                }}
              >
                <div className="bg-muted/50 px-3 py-1.5 border-b flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-400" />
                    <div className="w-3 h-3 rounded-full bg-yellow-400" />
                    <div className="w-3 h-3 rounded-full bg-green-400" />
                  </div>
                  <span className="text-xs text-muted-foreground truncate flex-1">
                    {embedUrl}
                  </span>
                </div>
                <iframe
                  key={previewKey}
                  src={embedUrl}
                  width={embedWidth}
                  height={`${embedHeight}px`}
                  style={{ 
                    border: 'none', 
                    display: 'block',
                    maxWidth: '100%'
                  }}
                  title="Embed Preview"
                  loading="lazy"
                />
              </div>

              <div className="text-xs text-muted-foreground text-center">
                <p>Actual embed dimensions: {embedWidth} width × {embedHeight}px height</p>
                <p className="mt-1">Note: Preview may be scaled to fit this panel</p>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
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
