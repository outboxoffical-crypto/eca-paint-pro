import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, 
  Settings as SettingsIcon, 
  Store,
  Package,
  Cloud,
  Trash2,
  Edit,
  User,
  Phone,
  MapPin,
  LogOut,
  BookOpen
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export default function SettingsScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [settings, setSettings] = useState({
    cloudBackup: false,
    notifications: true,
    darkMode: false
  });
  const [dealerInfo, setDealerInfo] = useState<any>(null);
  const [productCount, setProductCount] = useState(0);

  useEffect(() => {
    const loadData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/");
        return;
      }

      // Load dealer info from database
      const { data: dealer } = await supabase
        .from('dealer_info')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();
      
      if (dealer) {
        setDealerInfo(dealer);
      }

      // Load product pricing count from database
      const { data: products } = await supabase
        .from('product_pricing')
        .select('id', { count: 'exact' })
        .eq('user_id', session.user.id);
      
      if (products) {
        setProductCount(products.length);
      }
    };
    loadData();
  }, [navigate]);

  const handleToggle = (setting: string) => {
    setSettings(prev => ({
      ...prev,
      [setting]: !prev[setting as keyof typeof prev]
    }));
  };

  const handleResetData = async () => {
    if (!confirm('Are you sure? This will delete all your dealer information and product pricing.')) {
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Delete dealer info
      await supabase
        .from('dealer_info')
        .delete()
        .eq('user_id', session.user.id);

      // Delete product pricing
      await supabase
        .from('product_pricing')
        .delete()
        .eq('user_id', session.user.id);

      // Delete rooms
      await supabase
        .from('rooms')
        .delete()
        .eq('user_id', session.user.id);

      toast({
        title: "Success",
        description: "All data has been reset.",
      });

      navigate('/dealer-info');
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to reset data",
        variant: "destructive",
      });
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({
      title: "Logged out",
      description: "You have been logged out successfully.",
    });
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="eca-gradient text-white p-4">
        <div className="flex items-center space-x-3">
          <Button 
            variant="ghost" 
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={() => navigate("/dashboard")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Settings</h1>
            <p className="text-white/80 text-sm">Manage your Cosvys preferences</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Dealer Information */}
        {dealerInfo && (
          <Card className="eca-shadow">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-lg">
                <div className="flex items-center">
                  <Store className="mr-2 h-5 w-5 text-primary" />
                  Personal Information
                </div>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => navigate("/dealer-info")}
                >
                  <Edit className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center space-x-3">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">{dealerInfo.dealer_name}</p>
                  <p className="text-sm text-muted-foreground">{dealerInfo.shop_name}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm">{dealerInfo.phone}</p>
              </div>
               {dealerInfo.address && (
                 <div className="flex items-center space-x-3">
                   <MapPin className="h-4 w-4 text-muted-foreground" />
                   <p className="text-sm">{dealerInfo.address}</p>
                 </div>
               )}
            </CardContent>
          </Card>
        )}

        {/* Product Pricing */}
        <Card className="eca-shadow">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-lg">
              <div className="flex items-center">
                <Package className="mr-2 h-5 w-5 text-secondary" />
                Product Pricing
              </div>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => navigate("/dealer-pricing")}
              >
                <Edit className="h-3 w-3 mr-1" />
                Manage
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{productCount} Products Configured</p>
                <p className="text-sm text-muted-foreground">
                  Custom pricing for dealer-specific products
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lead Book */}
        <Card className="eca-shadow">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-lg">
              <div className="flex items-center">
                <BookOpen className="mr-2 h-5 w-5 text-primary" />
                Lead Book
              </div>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => navigate("/lead-book")}
              >
                <Edit className="h-3 w-3 mr-1" />
                Manage
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Lead Management</p>
                <p className="text-sm text-muted-foreground">
                  Track leads, conversions, and dealer approvals
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* App Settings */}
        <Card className="eca-shadow">
          <CardHeader>
            <CardTitle className="flex items-center text-lg">
              <SettingsIcon className="mr-2 h-5 w-5 text-accent-foreground" />
              App Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="cloud-backup" className="font-medium">Cloud Backup</Label>
                <p className="text-sm text-muted-foreground">Sync data across devices</p>
              </div>
              <Switch
                id="cloud-backup"
                checked={settings.cloudBackup}
                onCheckedChange={() => handleToggle('cloudBackup')}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="notifications" className="font-medium">Notifications</Label>
                <p className="text-sm text-muted-foreground">Project reminders and updates</p>
              </div>
              <Switch
                id="notifications"
                checked={settings.notifications}
                onCheckedChange={() => handleToggle('notifications')}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="dark-mode" className="font-medium">Dark Mode</Label>
                <p className="text-sm text-muted-foreground">Toggle app appearance</p>
              </div>
              <Switch
                id="dark-mode"
                checked={settings.darkMode}
                onCheckedChange={() => handleToggle('darkMode')}
              />
            </div>
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card className="eca-shadow">
          <CardHeader>
            <CardTitle className="flex items-center text-lg">
              <Cloud className="mr-2 h-5 w-5 text-destructive" />
              Data Management
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              variant="destructive"
              onClick={handleResetData}
              className="w-full"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Reset All Data
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              This will delete all dealer information, product pricing, and project data. This action cannot be undone.
            </p>
            
            <Separator />
            
            <Button 
              variant="outline"
              onClick={handleLogout}
              className="w-full"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}