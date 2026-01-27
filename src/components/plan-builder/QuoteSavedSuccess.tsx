import { CheckCircle2, Copy, ExternalLink, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

interface QuoteSavedSuccessProps {
  quoteId: string;
  onCreateNew: () => void;
}

export function QuoteSavedSuccess({ quoteId, onCreateNew }: QuoteSavedSuccessProps) {
  const quoteUrl = `${window.location.origin}/quote/${quoteId}`;
  
  const handleCopyLink = () => {
    navigator.clipboard.writeText(quoteUrl);
    toast.success('Quote link copied to clipboard!');
  };
  
  const handleOpenQuote = () => {
    window.open(quoteUrl, '_blank');
  };
  
  return (
    <Card className="card-elevated border-primary/20 bg-primary/5">
      <CardContent className="pt-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-primary/20 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          
          <div>
            <h3 className="text-xl font-semibold text-foreground mb-1">
              Quote Saved Successfully!
            </h3>
            <p className="text-muted-foreground text-sm">
              Your quote has been saved and is ready to share
            </p>
          </div>
          
          {/* Quote Link Box */}
          <div className="bg-background rounded-lg p-3 border flex items-center gap-2">
            <input
              type="text"
              value={quoteUrl}
              readOnly
              className="flex-1 bg-transparent text-sm text-foreground truncate outline-none"
            />
            <Button size="sm" variant="ghost" onClick={handleCopyLink}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2">
            <Button 
              className="flex-1 btn-primary" 
              onClick={handleOpenQuote}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              View Quote
            </Button>
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={handleCopyLink}
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy Link
            </Button>
          </div>
          
          <Button 
            variant="ghost" 
            className="text-muted-foreground"
            onClick={onCreateNew}
          >
            Create Another Quote
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
