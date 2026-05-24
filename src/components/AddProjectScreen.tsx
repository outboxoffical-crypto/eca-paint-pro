import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, User, Phone, MapPin, Home, DollarSign, Ruler, Calendar as CalendarIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { projectSchema } from "@/lib/validations";

export default function AddProjectScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const projectId = location.state?.projectId;
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    customerName: "",
    mobile: "",
    address: "",
    projectTypes: [] as string[],
    quotationValue: "",
    areaSqft: "",
    projectDate: "",
    leadId: ""
  });

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/");
        return;
      }
      
      // If editing, load project data
      if (projectId) {
        await loadProjectData();
      }
    };
    checkAuth();
  }, [navigate, projectId]);

  const loadProjectData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (error) throw error;

      if (data) {
        setFormData({
          customerName: data.customer_name || "",
          mobile: data.phone || "",
          address: data.location || "",
          projectTypes: data.project_type ? data.project_type.split(',').map((t: string) => t.trim()) : [],
          quotationValue: data.quotation_value?.toString() || "",
          areaSqft: data.area_sqft?.toString() || "",
          projectDate: data.project_date ? new Date(data.project_date).toISOString().split('T')[0] : "",
          leadId: data.lead_id || ""
        });
      }
    } catch (error: any) {
      console.error('Error loading project:', error);
      toast({
        title: "Error",
        description: "Failed to load project data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent double submission
    if (submitting) return;

    // Validate required fields
    if (!formData.customerName || !formData.mobile || !formData.address || formData.projectTypes.length === 0) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields: Customer Name, Mobile, Address, and Project Type",
        variant: "destructive",
      });
      return;
    }

    if (formData.mobile.length !== 10) {
      toast({
        title: "Invalid Mobile Number",
        description: "Mobile number must be exactly 10 digits",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("You must be logged in");
      }

      // Trim and validate input values
      const trimmedCustomerName = formData.customerName.trim();
      const trimmedMobile = formData.mobile.trim();
      const trimmedAddress = formData.address.trim();

      if (!trimmedCustomerName || !trimmedMobile || !trimmedAddress) {
        toast({
          title: "Invalid Input",
          description: "Please ensure all fields contain valid data",
          variant: "destructive",
        });
        return;
      }

      if (projectId) {
        // Update existing project
        const { error } = await supabase
          .from('projects')
          .update({
            customer_name: trimmedCustomerName,
            phone: trimmedMobile,
            location: trimmedAddress,
            project_type: formData.projectTypes.join(', '),
            quotation_value: parseFloat(formData.quotationValue) || 0,
            area_sqft: parseFloat(formData.areaSqft) || 0,
            project_date: formData.projectDate || new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', projectId);

        if (error) throw error;

        toast({
          title: "Success",
          description: "Project updated successfully!",
        });

        navigate('/dashboard');
      } else {
        // Create new project in Supabase with validated data
        const validated = projectSchema.parse(formData);
        
        const { data: newProject, error } = await supabase
          .from('projects')
          .insert({
            user_id: session.user.id,
            lead_id: `LEAD-${Date.now()}`,
            customer_name: trimmedCustomerName,
            phone: trimmedMobile,
            location: trimmedAddress,
            project_type: formData.projectTypes.join(', '),
            quotation_value: 0,
            area_sqft: 0,
            project_status: 'In Progress',
            approval_status: 'Pending'
          })
          .select()
          .single();

        if (error) {
          console.error('Supabase insert error:', error);
          throw error;
        }

        if (!newProject) {
          throw new Error('Project creation failed - no data returned');
        }

        console.log('Project created successfully:', newProject);

        toast({
          title: "Success",
          description: "Project created successfully!",
        });

        // After creating a new project, continue to room measurements (skip the site-survey step in front-phase)
        navigate(`/room-measurement/${newProject.id}`);
      }
    } catch (error: any) {
      console.error('Submit error:', error);
      toast({
        title: "Error",
        description: error.message || "Please check your inputs and try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleProjectTypeToggle = (type: string) => {
    setFormData(prev => ({
      ...prev,
      projectTypes: prev.projectTypes.includes(type)
        ? prev.projectTypes.filter(t => t !== type)
        : [...prev.projectTypes, type]
    }));
  };

  const isFormValid = formData.customerName && formData.mobile.length === 10 && formData.address && formData.projectTypes.length > 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

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
            <h1 className="text-xl font-semibold">{projectId ? 'Edit Project' : 'New Project'}</h1>
            <p className="text-white/80 text-sm">{projectId ? 'Update project details' : 'Add customer details'}</p>
          </div>
        </div>
      </div>

      <div className="p-4">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Customer Information */}
          <Card className="eca-shadow">
            <CardHeader>
              <CardTitle className="flex items-center text-lg">
                <User className="mr-2 h-5 w-5 text-primary" />
                Customer Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="customerName" className="text-sm font-medium">
                  Customer Name *
                </Label>
                <Input
                  id="customerName"
                  placeholder="Enter customer name"
                  value={formData.customerName}
                  onChange={(e) => setFormData(prev => ({ ...prev, customerName: e.target.value }))}
                  className="h-12"
                  required
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="mobile" className="text-sm font-medium">
                  Mobile Number *
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    id="mobile"
                    type="tel"
                    placeholder="Enter 10-digit mobile number"
                    value={formData.mobile}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      mobile: e.target.value.replace(/\D/g, '').slice(0, 10) 
                    }))}
                    className="pl-10 h-12"
                    maxLength={10}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address" className="text-sm font-medium">
                  Address *
                </Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 text-muted-foreground h-4 w-4" />
                  <Textarea
                    id="address"
                    placeholder="Enter complete address"
                    value={formData.address}
                    onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                    className="pl-10 min-h-[80px]"
                    required
                    maxLength={500}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Project Type */}
          <Card className="eca-shadow">
            <CardHeader>
              <CardTitle className="flex items-center text-lg">
                <Home className="mr-2 h-5 w-5 text-secondary" />
                Project Type
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4">
                <div className="flex items-center space-x-2 p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors">
                  <Checkbox
                    id="interior"
                    checked={formData.projectTypes.includes("Interior")}
                    onCheckedChange={() => handleProjectTypeToggle("Interior")}
                  />
                  <Label htmlFor="interior" className="flex-1 cursor-pointer">
                    <div className="font-medium">Interior</div>
                    <div className="text-sm text-muted-foreground">Indoor walls, ceilings, rooms</div>
                  </Label>
                </div>
                
                <div className="flex items-center space-x-2 p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors">
                  <Checkbox
                    id="exterior"
                    checked={formData.projectTypes.includes("Exterior")}
                    onCheckedChange={() => handleProjectTypeToggle("Exterior")}
                  />
                  <Label htmlFor="exterior" className="flex-1 cursor-pointer">
                    <div className="font-medium">Exterior</div>
                    <div className="text-sm text-muted-foreground">Outer walls, facades, exteriors</div>
                  </Label>
                </div>
                
                <div className="flex items-center space-x-2 p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors">
                  <Checkbox
                    id="waterproofing"
                    checked={formData.projectTypes.includes("Waterproofing")}
                    onCheckedChange={() => handleProjectTypeToggle("Waterproofing")}
                  />
                  <Label htmlFor="waterproofing" className="flex-1 cursor-pointer">
                    <div className="font-medium">Waterproofing</div>
                    <div className="text-sm text-muted-foreground">Damp proofing and waterproofing solutions</div>
                  </Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Additional Details (shown when editing) */}
          {projectId && (
            <>
              <Card className="eca-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center text-lg">
                    <DollarSign className="mr-2 h-5 w-5 text-primary" />
                    Project Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="leadId" className="text-sm font-medium">
                      Lead ID
                    </Label>
                    <Input
                      id="leadId"
                      value={formData.leadId}
                      disabled
                      className="bg-muted"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="quotationValue" className="text-sm font-medium">
                      Quotation Value (₹)
                    </Label>
                    <Input
                      id="quotationValue"
                      type="number"
                      placeholder="Enter quotation value"
                      value={formData.quotationValue}
                      onChange={(e) => setFormData(prev => ({ ...prev, quotationValue: e.target.value }))}
                      className="h-12"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="areaSqft" className="text-sm font-medium">
                      Area (Sq.ft)
                    </Label>
                    <div className="relative">
                      <Ruler className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                      <Input
                        id="areaSqft"
                        type="number"
                        placeholder="Enter area in sq.ft"
                        value={formData.areaSqft}
                        onChange={(e) => setFormData(prev => ({ ...prev, areaSqft: e.target.value }))}
                        className="pl-10 h-12"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="projectDate" className="text-sm font-medium">
                      Project Date
                    </Label>
                    <div className="relative">
                      <CalendarIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                      <Input
                        id="projectDate"
                        type="date"
                        value={formData.projectDate}
                        onChange={(e) => setFormData(prev => ({ ...prev, projectDate: e.target.value }))}
                        className="pl-10 h-12"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* Submit Button */}
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border">
            <Button 
              type="submit"
              className="w-full h-12 text-base font-medium"
              disabled={!isFormValid || submitting}
            >
              {submitting ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  <span>{projectId ? 'Saving...' : 'Creating...'}</span>
                </div>
              ) : (
                projectId ? 'Save Changes' : 'Continue to Measurements'
              )}
            </Button>
          </div>
        </form>
      </div>

      {/* Bottom padding to account for fixed button */}
      <div className="h-20"></div>
    </div>
  );
}