import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Phone, MapPin, Mail } from "lucide-react";
import cosvysLogo from "@/assets/cosvys-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export default function DealerInfoScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    shopName: "",
    address: ""
  });

  useEffect(() => {
    // Check if user is logged in and load existing dealer info
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/");
        return;
      }

      // Check if dealer info already exists
      const { data: dealerInfo } = await supabase
        .from('dealer_info')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();
      
       if (dealerInfo) {
         // Load existing data for editing
         setIsEditMode(true);
         setFormData({
           name: dealerInfo.dealer_name || "",
           phone: dealerInfo.phone || "",
           email: dealerInfo.email || "",
           shopName: dealerInfo.shop_name || "",
           address: dealerInfo.address || ""
         });
       }
    };
    checkAuth();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate required fields
      if (!formData.name.trim()) {
        throw new Error("Name is required");
      }
      if (!formData.phone || formData.phone.length !== 10) {
        throw new Error("Please enter a valid 10-digit phone number");
      }
      if (!formData.shopName.trim()) {
        throw new Error("Shop Name is required");
      }
      if (!formData.address.trim()) {
        throw new Error("Address is required");
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("You must be logged in");
      }

      if (isEditMode) {
        // Update existing dealer info
        const { error } = await supabase
          .from('dealer_info')
          .update({
            dealer_name: formData.name,
            phone: formData.phone,
            email: formData.email || null,
            address: formData.address,
            shop_name: formData.shopName
          })
          .eq('user_id', session.user.id);

        if (error) throw error;

        toast({
          title: "Success",
          description: "Information updated successfully!",
        });

        navigate("/dashboard");
      } else {
        // Insert new dealer info
         const { error } = await supabase
           .from('dealer_info')
           .insert({
             user_id: session.user.id,
             dealer_name: formData.name,
             phone: formData.phone,
             email: formData.email || null,
             shop_name: formData.shopName,
             address: formData.address
           });

        if (error) throw error;

        toast({
          title: "Success",
          description: "Information saved successfully!",
        });

        navigate("/dashboard");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Please check your inputs and try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

   const isFormValid = formData.name && formData.phone.length === 10 && formData.shopName && formData.address;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="eca-gradient text-white p-4">
        <div className="flex items-center space-x-3 mb-4">
          <img 
            src={cosvysLogo} 
            alt="Cosvys" 
            className="h-8 w-auto object-contain"
          />
          <div>
            <h1 className="text-xl font-semibold">{isEditMode ? 'Edit Information' : 'Cosvys Setup'}</h1>
            <p className="text-white/80 text-sm">Basic Information</p>
          </div>
        </div>
      </div>

      <div className="p-4">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Personal Information */}
          <Card className="eca-shadow">
            <CardHeader>
              <CardTitle className="text-lg">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium">
                  Name *
                </Label>
                <Input
                  id="name"
                  placeholder="Enter your name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="h-12"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-medium">
                  Phone Number *
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="Enter 10-digit phone number"
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      phone: e.target.value.replace(/\D/g, '').slice(0, 10) 
                    }))}
                    className="pl-10 h-12"
                    maxLength={10}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter email address"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    className="pl-10 h-12"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address" className="text-sm font-medium">
                  Address
                </Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 text-muted-foreground h-4 w-4" />
                  <Textarea
                    id="address"
                    placeholder="Enter your address"
                    value={formData.address}
                    onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                    className="pl-10 min-h-[80px]"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Shop Information */}
          <Card className="eca-shadow">
            <CardHeader>
              <CardTitle className="text-lg">Shop Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="shopName" className="text-sm font-medium">
                  Shop Name *
                </Label>
               <Input
                   id="shopName"
                   placeholder="Enter shop name"
                   value={formData.shopName}
                   onChange={(e) => setFormData(prev => ({ ...prev, shopName: e.target.value }))}
                   className="h-12"
                   required
                 />
               </div>
             </CardContent>
           </Card>

          {/* Submit Button */}
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border">
            <Button 
              type="submit"
              className="w-full h-12 text-base font-medium"
              disabled={!isFormValid || loading}
            >
              {loading ? "Saving..." : isEditMode ? "Update Information" : "Continue"}
            </Button>
          </div>
        </form>
      </div>

      {/* Bottom padding to account for fixed button */}
      <div className="h-20"></div>
    </div>
  );
}