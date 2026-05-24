import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { roomQueries } from "@/lib/queries";
import { useToast } from "@/hooks/use-toast";
import ProjectDetailsModal from "./ProjectDetailsModal";
import { MaterialTracker } from "./MaterialTracker";
import { LabourTracker } from "./LabourTracker";
import { LeadSummaryBox } from "./LeadSummaryBox";
import { format } from "date-fns";
import { 
  Plus, 
  Search, 
  Home, 
  Calendar, 
  DollarSign,
  Ruler,
  MapPin,
  Phone,
  MoreVertical,
  Settings,
  Package,
  CheckCircle2,
  Bell,
  Users,
  Edit2,
  BookOpen,
  TrendingUp,
  TrendingDown,
  Clock
} from "lucide-react";
import cosvysLogo from "@/assets/cosvys-logo.png";

interface Project {
  id: string;
  lead_id: string;
  customer_name: string;
  phone: string;
  location: string;
  project_type: string;
  project_status: string;
  quotation_value: number;
  area_sqft: number;
  project_date: string;
  approval_status: string;
  reminder_sent: boolean;
  notification_count: number;
  created_at: string;
  start_date?: string | null;
  end_date?: string | null;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [dealerInfo, setDealerInfo] = useState<any>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [materialTrackerOpen, setMaterialTrackerOpen] = useState(false);
  const [materialTrackerProjectId, setMaterialTrackerProjectId] = useState<string | null>(null);
  const [labourTrackerOpen, setLabourTrackerOpen] = useState(false);
  const [labourTrackerProjectId, setLabourTrackerProjectId] = useState<string | null>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [leadStats, setLeadStats] = useState({ total: 0, converted: 0, dropped: 0, pending: 0 });
  const [userName, setUserName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [userInitials, setUserInitials] = useState<string>("");
  const [projectHasMeasurements, setProjectHasMeasurements] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const stored = localStorage.getItem('dealerInfo');
    if (stored) {
      setDealerInfo(JSON.parse(stored));
    }
    fetchProjects();
    fetchLeadStats();
    fetchUserProfile();
    
    // Subscribe to realtime updates
    const channel = supabase
      .channel('projects-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        fetchProjects();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchUserProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', user.id)
        .single();
      
      if (profile?.full_name) {
        setUserName(profile.full_name);
        const initials = profile.full_name
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);
        setUserInitials(initials);
      }
      
      if (profile?.avatar_url) {
        setAvatarUrl(profile.avatar_url);
      }

      // Fetch dealer info from database
      const { data: dealer } = await supabase
        .from('dealer_info')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (dealer) {
        setDealerInfo(dealer);
        localStorage.setItem('dealerInfo', JSON.stringify(dealer));
      }
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type (only allow images)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a JPG, PNG, or WebP image",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 2MB)
    const maxSizeBytes = 2 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      // Size check kept but notification suppressed per user request.
      // Silently ignore files that exceed the configured maximum.
      console.warn('Avatar upload skipped: file exceeds max size');
      return;
    }

    // Validate file extension matches content type
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    const validExtensions = ['jpg', 'jpeg', 'png', 'webp'];
    if (!fileExt || !validExtensions.includes(fileExt)) {
      toast({
        title: "Invalid file extension",
        description: "Please upload a file with .jpg, .jpeg, .png, or .webp extension",
        variant: "destructive",
      });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Sanitize filename - use fixed extension based on content type
      const safeExt = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
      const filePath = `${user.id}/avatar.${safeExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { 
          upsert: true,
          contentType: file.type 
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setAvatarUrl(publicUrl);
      toast({
        title: "Success",
        description: "Profile picture updated!",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to upload profile picture",
        variant: "destructive",
      });
    }
  };

  const fetchProjects = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', user.id)
      .not('customer_name', 'is', null)
      .not('phone', 'is', null)
      .not('location', 'is', null)
      .neq('customer_name', '')
      .neq('phone', '')
      .neq('location', '')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error fetching projects:', error);
      toast({
        title: "Error",
        description: "Failed to load projects",
        variant: "destructive",
      });
      } else if (data) {
      // Deduplicate projects by phone number (unique per customer)
      const statusPriority: Record<string, number> = { 'Quoted': 3, 'In Progress': 2 };
      const uniqueMap = new Map();

      data.forEach(project => {
        const key = project.phone; // Use phone as unique identifier
        const existing = uniqueMap.get(key);
        const currentPriority = statusPriority[project.project_status] || 1;

        if (!existing) {
          uniqueMap.set(key, project);
        } else {
          const existingPriority = statusPriority[existing.project_status] || 1;
          if (currentPriority > existingPriority) {
            // Higher status wins (Quoted > In Progress)
            uniqueMap.set(key, project);
          } else if (currentPriority === existingPriority) {
            // Same status: keep the newest (by updated_at or created_at)
            const existingDate = new Date(existing.updated_at || existing.created_at);
            const currentDate = new Date(project.updated_at || project.created_at);
            if (currentDate > existingDate) {
              uniqueMap.set(key, project);
            }
          }
        }
      });

      const uniqueProjects = Array.from(uniqueMap.values());
      setProjects(uniqueProjects);

      // Load a small map of which projects have room measurements so the UI
      // can optionally show/hide labour & material trackers in the front phase.
      (async () => {
        try {
          const map: Record<string, boolean> = {};
          await Promise.all(uniqueProjects.map(async (p: Project) => {
            try {
              const { data: rooms } = await roomQueries.getRoomsByProjectId(p.id);
              map[p.id] = !!(rooms && rooms.length > 0);
            } catch (e) {
              map[p.id] = false;
            }
          }));
          setProjectHasMeasurements(map);
        } catch (e) {
          // keep default empty map on error
          setProjectHasMeasurements({});
        }
      })();
    } else {
      setProjects([]);
    }
    setLoading(false);
  };


  const fetchLeadStats = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('leads')
        .select('status, approval_status')
        .eq('user_id', user.id);

      if (error) throw error;

      const total = data?.length || 0;
      const converted = data?.filter(l => l.status === 'Converted').length || 0;
      const dropped = data?.filter(l => l.status === 'Dropped').length || 0;
      const pending = data?.filter(l => l.approval_status === 'Pending').length || 0;

      setLeadStats({ total, converted, dropped, pending });
    } catch (error) {
      console.error('Error fetching lead stats:', error);
    }
  };

  const filteredProjects = projects.filter(project =>
    project.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleApproval = async (projectId: string) => {
    try {
      // Get the project to log activity
      const { data: project } = await supabase
        .from('projects')
        .select('customer_name')
        .eq('id', projectId)
        .single();

      // Update project status to Approved
      const { error: updateError } = await supabase
        .from('projects')
        .update({ 
          approval_status: 'Approved',
          updated_at: new Date().toISOString()
        })
        .eq('id', projectId);

      if (updateError) throw updateError;

      // Log activity
      await supabase
        .from('project_activity_log')
        .insert({
          project_id: projectId,
          activity_type: 'approval_simulated',
          activity_message: `Project approved for ${project?.customer_name || 'customer'}`,
        });

      toast({
        title: "Success",
        description: "Project Approved Successfully",
      });
    } catch (error: any) {
      console.error('Error approving project:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to approve project",
        variant: "destructive",
      });
    }
  };

  const handleReminder = async (projectId: string) => {
    const companyName = dealerInfo?.shopName || "Cosvys";
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const { error } = await supabase.functions.invoke('send-reminder-sms', {
        body: { projectId, companyName },
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Reminder SMS sent successfully",
      });
    } catch (error: any) {
      console.error('Error sending reminder:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to send reminder SMS",
        variant: "destructive",
      });
    }
  };

  const handleViewDetails = (projectId: string) => {
    setSelectedProjectId(projectId);
    setDetailsModalOpen(true);
  };

const handleEditProject = async (projectId: string) => {
  // Check if the current project has any rooms
  const { data: rooms, error } = await supabase
    .from('rooms')
    .select('id')
    .eq('project_id', projectId)
    .limit(1);

  if (error) {
    console.error('Error checking rooms:', error);
    // If there's an error, fallback to original behavior
    navigate(`/room-measurement/${projectId}`);
    return;
  }

  // If rooms exist, navigate directly
  if (rooms && rooms.length > 0) {
    navigate(`/room-measurement/${projectId}`);
    return;
  }

  // No rooms found – try to find another project for the same customer that has rooms
  // First, get the current project's phone number (unique identifier)
  const { data: currentProject, error: projectError } = await supabase
    .from('projects')
    .select('phone, customer_name')
    .eq('id', projectId)
    .single();

  if (projectError || !currentProject) {
    console.error('Error fetching current project:', projectError);
    navigate(`/room-measurement/${projectId}`);
    return;
  }

  // Look for another project with the same phone, status 'In Progress', and with rooms
  const { data: otherProjects, error: otherError } = await supabase
    .from('projects')
    .select('id')
    .eq('phone', currentProject.phone)
    .eq('project_status', 'In Progress')
    .neq('id', projectId)
    .limit(1);

  if (otherError) {
    console.error('Error finding other projects:', otherError);
    navigate(`/room-measurement/${projectId}`);
    return;
  }

  if (otherProjects && otherProjects.length > 0) {
    // Check if that candidate project has rooms
    const { data: otherRooms } = await supabase
      .from('rooms')
      .select('id')
      .eq('project_id', otherProjects[0].id)
      .limit(1);

    if (otherRooms && otherRooms.length > 0) {
      // Found a project with rooms – navigate there
      navigate(`/room-measurement/${otherProjects[0].id}`);
      return;
    }
  }

  // No project with rooms found – show a message and navigate to current (empty) project
  toast({
    title: "No rooms found",
    description: "This project has no room measurements yet. Please add rooms.",
  });
  navigate(`/room-measurement/${projectId}`);
};


  const handleOpenMaterialTracker = (projectId: string) => {
    setMaterialTrackerProjectId(projectId);
    setMaterialTrackerOpen(true);
  };

  const handleOpenLabourTracker = (projectId: string) => {
    setLabourTrackerProjectId(projectId);
    setLabourTrackerOpen(true);
  };

  const handleDateUpdate = async (projectId: string, dateField: 'start_date' | 'end_date', date: Date | undefined) => {
    if (!date) return;
    
    try {
      // Format date properly to avoid timezone issues
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;
      
      const { error } = await supabase
        .from('projects')
        .update({ 
          [dateField]: formattedDate,
          updated_at: new Date().toISOString()
        })
        .eq('id', projectId);

      if (error) throw error;

      // Refresh projects to show updated date
      await fetchProjects();

      toast({
        title: "Success",
        description: `${dateField === 'start_date' ? 'Start' : 'End'} date updated successfully`,
      });
    } catch (error: any) {
      console.error('Error updating date:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update date",
        variant: "destructive",
      });
    }
  };

  const calculateDuration = (startDate?: string | null, endDate?: string | null) => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "In Progress": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "Completed": return "bg-green-100 text-green-800 border-green-200";
      case "Quoted": return "bg-blue-100 text-blue-800 border-blue-200";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const totalValue = projects.reduce((sum, p) => sum + p.quotation_value, 0);
  const totalArea = projects.reduce((sum, p) => sum + p.area_sqft, 0);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="eca-gradient text-white p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <label htmlFor="avatar-upload" className="cursor-pointer">
              <Avatar className="h-12 w-12 border-2 border-white/20 hover:border-white/40 transition-all">
                <AvatarImage src={avatarUrl} alt={userName || 'User'} />
                <AvatarFallback className="bg-white/10 text-white font-semibold">
                  {userInitials || 'U'}
                </AvatarFallback>
              </Avatar>
            </label>
            <input
              id="avatar-upload"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <div>
              <h1 className="text-xl font-semibold">{dealerInfo?.dealer_name || 'Your Business'}</h1>
              <p className="text-white/80 text-sm">
                {userName || 'User'}
              </p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={() => navigate("/settings")}
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/70 h-4 w-4" />
          <Input
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/30"
          />
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="text-center eca-shadow">
            <CardContent className="p-4">
              <Home className="h-6 w-6 text-primary mx-auto mb-2" />
              <p className="text-2xl font-bold text-foreground">{projects.length}</p>
              <p className="text-sm text-muted-foreground">Total Projects</p>
            </CardContent>
          </Card>
          <Card className="text-center eca-shadow">
            <CardContent className="p-4">
              <DollarSign className="h-6 w-6 text-secondary mx-auto mb-2" />
              <p className="text-2xl font-bold text-foreground">
                ₹{totalValue >= 100000
                  ? `${(totalValue / 100000).toFixed(1)}L`
                  : `${(totalValue / 1000).toFixed(0)}K`}
              </p>
              <p className="text-sm text-muted-foreground">Total Value</p>
            </CardContent>
          </Card>
          <Card className="text-center eca-shadow">
            <CardContent className="p-4">
              <Ruler className="h-6 w-6 text-accent-foreground mx-auto mb-2" />
              <p className="text-2xl font-bold text-foreground">{(totalArea / 1000).toFixed(1)}K</p>
              <p className="text-sm text-muted-foreground">Total Sq.Ft</p>
            </CardContent>
          </Card>
        </div>


        {/* Quick Actions Grid */}
        <div className="flex flex-nowrap gap-2 sm:gap-3 mb-6 justify-center">
          <Button 
            onClick={() => navigate("/add-project")}
            className="flex-1 min-w-[100px] h-14 sm:h-16 bg-primary hover:bg-primary-hover text-primary-foreground eca-shadow hover:shadow-lg transition-all rounded-lg"
          >
            <div className="flex items-center gap-1.5 sm:gap-2 w-full justify-center px-2">
              <Plus className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
              <span className="font-semibold text-[10px] sm:text-xs whitespace-nowrap">New Project</span>
            </div>
          </Button>
          
          <Button
            onClick={() => navigate("/lead-book")}
            variant="outline"
            className="flex-1 min-w-[100px] h-14 sm:h-16 bg-card hover:bg-muted text-foreground eca-shadow hover:shadow-lg transition-all rounded-lg border-border"
          >
            <div className="flex items-center gap-1.5 sm:gap-2 w-full justify-center px-2">
              <BookOpen className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0 text-foreground" />
              <span className="font-semibold text-[10px] sm:text-xs whitespace-nowrap">Lead Summary</span>
            </div>
          </Button>
        </div>

        {/* Projects List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Recent Projects</h2>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => navigate("/saved-projects")}
            >
              View All
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-12">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
            </div>
          ) : filteredProjects.length === 0 ? (
            <Card className="text-center p-8 eca-shadow">
              <Home className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No Projects Found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery ? "Try a different search term" : "Create your first project to get started"}
              </p>
              {!searchQuery && (
                <Button onClick={() => navigate("/add-project")}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Project
                </Button>
              )}
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredProjects.map((project) => (
                <Card key={project.id} className="eca-shadow hover:shadow-lg transition-shadow">
                  <CardContent className="p-4">
                     <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-foreground">
                            {project.customer_name || 'Incomplete Project'}
                          </h3>
                          {project.approval_status === 'Approved' && (
                            <Badge className="bg-green-500 text-white">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Approved
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center text-sm text-muted-foreground mt-1">
                          <Phone className="h-3 w-3 mr-1" />
                          {project.phone || 'No contact'}
                        </div>
                        <div className="flex items-center text-sm text-muted-foreground mt-1">
                          <MapPin className="h-3 w-3 mr-1" />
                          {project.location || 'No address'}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-primary hover:bg-primary/10"
                              onClick={() => handleEditProject(project.id)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit Project</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => handleViewDetails(project.id)}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View Details</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-4">
                        <Badge variant="outline" className={getStatusColor(project.project_status)}>
                          {project.project_status}
                        </Badge>
                        <span className="text-sm text-muted-foreground">{project.project_type}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-foreground">{Math.round(project.area_sqft)} sq.ft</p>
                      </div>
                    </div>

                    {/* Action Buttons Section */}
                    <div className="pt-3 border-t border-border space-y-2">
                      {project.approval_status !== 'Approved' ? (
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                          <div className="flex items-center text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3 mr-1 flex-shrink-0" />
                            {format(new Date(project.project_date), "dd MMM yyyy")}
                          </div>
                          
                          <div className="flex items-center gap-2 flex-wrap">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  className="h-8 px-2.5 bg-green-50 hover:bg-green-100 text-green-700 border-green-200 rounded-md"
                                  onClick={() => handleApproval(project.id)}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Send approval request</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  className="h-8 px-2.5 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 border-yellow-200 rounded-md relative"
                                  onClick={() => handleReminder(project.id)}
                                >
                                  <Bell className="h-3.5 w-3.5" />
                                  {project.notification_count > 0 && (
                                    <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                                      {project.notification_count}
                                    </span>
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Send reminder</TooltipContent>
                            </Tooltip>

                            <Button 
                              size="sm" 
                              variant="outline"
                              className="h-8 px-2.5 rounded-md text-xs whitespace-nowrap"
                              onClick={() => handleViewDetails(project.id)}
                            >
                              View Details
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* First Row: Start/End Date buttons (left) | View Details (right) */}
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2.5 text-xs rounded-md flex-shrink-0"
                                  >
                                    <Calendar className="h-3 w-3 mr-1" />
                                    <span className="whitespace-nowrap">
                                      {project.start_date ? format(new Date(project.start_date), "dd MMM") : "Start Date"}
                                    </span>
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <CalendarComponent
                                    mode="single"
                                    selected={project.start_date ? new Date(project.start_date) : undefined}
                                    onSelect={(date) => handleDateUpdate(project.id, 'start_date', date)}
                                    initialFocus
                                    className="pointer-events-auto"
                                  />
                                </PopoverContent>
                              </Popover>

                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2.5 text-xs rounded-md flex-shrink-0"
                                  >
                                    <Calendar className="h-3 w-3 mr-1" />
                                    <span className="whitespace-nowrap">
                                      {project.end_date ? format(new Date(project.end_date), "dd MMM") : "End Date"}
                                    </span>
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <CalendarComponent
                                    mode="single"
                                    selected={project.end_date ? new Date(project.end_date) : undefined}
                                    onSelect={(date) => handleDateUpdate(project.id, 'end_date', date)}
                                    initialFocus
                                    className="pointer-events-auto"
                                  />
                                </PopoverContent>
                              </Popover>
                            </div>

                            <Button 
                              size="sm" 
                              variant="default"
                              className="h-8 px-2.5 text-xs whitespace-nowrap rounded-md flex-shrink-0"
                              onClick={() => handleViewDetails(project.id)}
                            >
                              View Details
                            </Button>
                          </div>

                          {/* Second Row: Project Date (left) | Labour & Material Icons (right) */}
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="flex items-center text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3 mr-1 flex-shrink-0" />
                                {format(new Date(project.project_date), "dd MMM yyyy")}
                              </div>
                              {project.start_date && project.end_date && (
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  • {calculateDuration(project.start_date, project.end_date)} days
                                </span>
                              )}
                            </div>

                             {projectHasMeasurements[project.id] ? (
                               <div className="flex items-center gap-2">
                                 <Button
                                   size="sm"
                                   variant="ghost"
                                   className="h-8 w-8 p-0 rounded-md hover:bg-muted"
                                   onClick={() => handleOpenLabourTracker(project.id)}
                                   title="Labour Tracker"
                                 >
                                   <Users className="h-4 w-4 text-red-500" />
                                 </Button>

                                 <Button
                                   size="sm"
                                   variant="ghost"
                                   className="h-8 w-8 p-0 rounded-md hover:bg-muted"
                                   onClick={() => handleOpenMaterialTracker(project.id)}
                                   title="Material Tracker"
                                 >
                                   <Package className="h-4 w-4 text-purple-500" />
                                 </Button>
                               </div>
                             ) : null}
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <ProjectDetailsModal 
        projectId={selectedProjectId}
        open={detailsModalOpen}
        onOpenChange={setDetailsModalOpen}
      />

      {materialTrackerProjectId && (
        <MaterialTracker
          projectId={materialTrackerProjectId}
          isOpen={materialTrackerOpen}
          onClose={() => {
            setMaterialTrackerOpen(false);
            setMaterialTrackerProjectId(null);
          }}
        />
      )}

      {labourTrackerProjectId && (
        <LabourTracker
          projectId={labourTrackerProjectId}
          isOpen={labourTrackerOpen}
          onClose={() => {
            setLabourTrackerOpen(false);
            setLabourTrackerProjectId(null);
          }}
        />
      )}

    </div>
    </TooltipProvider>
  );
}
