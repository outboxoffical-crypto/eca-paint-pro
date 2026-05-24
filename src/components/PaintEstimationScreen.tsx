import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue, startTransition } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Palette, Plus, Minus, Settings, Trash2, ChevronsUpDown, Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { RateInput } from "@/components/ui/rate-input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getOrFetchRooms, getOrFetchCoverageData } from "@/hooks/usePrefetch";
import { useProjectCache } from "@/hooks/useProjectCache";
import { safeNumber, calculateProjectTotals } from "@/lib/calculations";
import { Skeleton } from "@/components/ui/skeleton";

// PERFORMANCE: Use requestIdleCallback for non-blocking background work
const scheduleIdleTask = (callback: () => void) => {
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(callback, { timeout: 100 });
  } else {
    setTimeout(callback, 0);
  }
};
import { getGlobalDisplayOrder, sortByGlobalDisplayOrder, createConfigsHash } from "@/lib/configOrdering";
interface CoverageData {
  id: string;
  category: string;
  product_name: string;
  coats: string;
  coverage_range: string;
  surface_type?: string;
  notes?: string;
}
interface AreaConfiguration {
  id: string;
  areaType: 'Floor' | 'Wall' | 'Ceiling' | 'Enamel';
  paintingSystem: 'Fresh Painting' | 'Repainting' | null;
  coatConfiguration: {
    putty: number;
    primer: number;
    emulsion: number;
  };
  repaintingConfiguration: {
    primer: number;
    emulsion: number;
  };
  selectedMaterials: {
    putty: string;
    primer: string;
    emulsion: string;
  };
  area: number;
  perSqFtRate: string;
  label?: string;
  isAdditional?: boolean;
  isCustomSection?: boolean;
  roomId?: string;
  subAreaId?: string;
  enamelConfig?: {
    primerType: string;
    primerCoats: number;
    enamelType: string;
    enamelCoats: number;
  };
  displayOrder?: number; // GLOBAL: 1=Wall, 2=Ceiling, 3=Floor, 4=Separate, 5=Enamel, 6=Separate Enamel
  areaPriority?: number; // Legacy support
}

export default function PaintEstimationScreen() {
  const navigate = useNavigate();
  const {
    projectId
  } = useParams();

  // Use project cache for memoized calculations
  const {
    getCachedProjectTotals
  } = useProjectCache(projectId);

  // Track if initial load is done to prevent re-fetching
  const initialLoadDone = useRef(false);
  const configsInitialized = useRef(false);
  
  // Data readiness tracking - CRITICAL for mobile hydration
  // Start with true to show UI immediately, update silently
  const [dataReady, setDataReady] = useState(true);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [coverageLoaded, setCoverageLoaded] = useState(false);
  const [localStorageHydrated, setLocalStorageHydrated] = useState(false);
  
  // PERFORMANCE: Progressive rendering state - render cards in batches
  const [configsCalculating, setConfigsCalculating] = useState(false);
  const [visibleConfigCount, setVisibleConfigCount] = useState(4); // Start with 4 cards visible
  
  const [selectedPaintType, setSelectedPaintType] = useState<"Interior" | "Exterior" | "Waterproofing">("Interior");
  const [rooms, setRooms] = useState<any[]>([]);
  const [coverageData, setCoverageData] = useState<CoverageData[]>([]);
  const [enamelPrimerProducts, setEnamelPrimerProducts] = useState<string[]>([]);
  const [apcoliteEnamelProducts, setApcoliteEnamelProducts] = useState<string[]>([]);

  // Separate state for each paint type to prevent mixing
  const [interiorConfigurations, setInteriorConfigurations] = useState<AreaConfiguration[]>([]);
  const [exteriorConfigurations, setExteriorConfigurations] = useState<AreaConfiguration[]>([]);
  const [waterproofingConfigurations, setWaterproofingConfigurations] = useState<AreaConfiguration[]>([]);

  // Current configurations based on selected paint type - memoized
  const areaConfigurations = useMemo(() => {
    return selectedPaintType === "Interior" ? interiorConfigurations : selectedPaintType === "Exterior" ? exteriorConfigurations : waterproofingConfigurations;
  }, [selectedPaintType, interiorConfigurations, exteriorConfigurations, waterproofingConfigurations]);

  // CRITICAL: Frozen snapshot using GLOBAL ordering - IMMUTABLE during render
  // Prevents mobile incremental rendering from affecting order
  const frozenOrderRef = useRef<AreaConfiguration[]>([]);
  const lastConfigsHash = useRef<string>('');
  
  // GLOBAL SORT: Compute ordered snapshot ONCE and freeze it
  const sortedConfigurationsForSummary = useMemo(() => {
    // Create hash to detect actual data changes
    const configsHash = createConfigsHash(areaConfigurations);
    
    // Only recompute if data actually changed (not during layout reflow)
    if (configsHash !== lastConfigsHash.current || frozenOrderRef.current.length === 0) {
      lastConfigsHash.current = configsHash;
      
      // USE GLOBAL SORTING - Single source of truth
      const sorted = sortByGlobalDisplayOrder(areaConfigurations) as AreaConfiguration[];
      
      // FREEZE the order - this snapshot won't change during render
      frozenOrderRef.current = sorted;
    }
    
    // Always return the frozen snapshot
    return frozenOrderRef.current;
  }, [areaConfigurations]);

  // PERFORMANCE: Visible configurations - only render what's needed for progressive loading
  const visibleConfigurations = useMemo(() => {
    return sortedConfigurationsForSummary.slice(0, visibleConfigCount);
  }, [sortedConfigurationsForSummary, visibleConfigCount]);

  const setAreaConfigurations = useCallback((updater: AreaConfiguration[] | ((prev: AreaConfiguration[]) => AreaConfiguration[])) => {
    if (selectedPaintType === "Interior") {
      setInteriorConfigurations(updater);
    } else if (selectedPaintType === "Exterior") {
      setExteriorConfigurations(updater);
    } else {
      setWaterproofingConfigurations(updater);
    }
  }, [selectedPaintType]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCalculating, setIsCalculating] = useState(false);
  const [emulsionComboOpen, setEmulsionComboOpen] = useState(false);

  // Data readiness check - show loading only initially, then update silently
  useEffect(() => {
    if (roomsLoaded && localStorageHydrated && !configsInitialized.current) {
      // Core data is ready - hide loading immediately
      configsInitialized.current = true;
      setIsLoading(false);
    }
  }, [roomsLoaded, localStorageHydrated]);

  // Sync initial paint type, prefer snapshot from Generate Summary
  useEffect(() => {
    try {
      const estimationKey = `estimation_${projectId}`;
      const estimationStr = localStorage.getItem(estimationKey);
      if (estimationStr) {
        const est = JSON.parse(estimationStr);
        const pt: any = est.paintType;
        if (pt === 'Interior' || pt === 'Exterior' || pt === 'Waterproofing') {
          setSelectedPaintType(pt);
          localStorage.setItem(`selected_paint_type_${projectId}`, pt);
          // Hydrate preserved configs so returning from Summary keeps selections
          const preservedKey = `configs_preserved_${projectId}_${pt}`;
          if (Array.isArray(est.configurations)) {
            localStorage.setItem(preservedKey, JSON.stringify(est.configurations));
          }
        }
        return;
      }
      const key = `selected_paint_type_${projectId}`;
      const t = localStorage.getItem(key);
      if (t === 'Interior' || t === 'Exterior' || t === 'Waterproofing') {
        setSelectedPaintType(t as any);
      }
    } catch {}
  }, [projectId]);

  // Persist paint type selection so it survives navigation
  useEffect(() => {
    try {
      if (projectId && selectedPaintType) {
        localStorage.setItem(`selected_paint_type_${projectId}`, selectedPaintType);
      }
    } catch {}
  }, [selectedPaintType, projectId]);

  // Quick hydrate all configs from localStorage on mount
  useEffect(() => {
    try {
      // Load Interior configs
      const interiorKey = `paint_configs_${projectId}_Interior`;
      const interiorRaw = typeof window !== 'undefined' ? localStorage.getItem(interiorKey) : null;
      const interiorList = interiorRaw ? JSON.parse(interiorRaw) : [];
      if (Array.isArray(interiorList) && interiorList.length > 0) {
        setInteriorConfigurations(interiorList);
      } else {
        const preservedKey = `configs_preserved_${projectId}_Interior`;
        const raw2 = typeof window !== 'undefined' ? localStorage.getItem(preservedKey) : null;
        const list2 = raw2 ? JSON.parse(raw2) : [];
        if (Array.isArray(list2) && list2.length > 0) {
          setInteriorConfigurations(list2);
        }
      }

      // Load Exterior configs
      const exteriorKey = `paint_configs_${projectId}_Exterior`;
      const exteriorRaw = typeof window !== 'undefined' ? localStorage.getItem(exteriorKey) : null;
      const exteriorList = exteriorRaw ? JSON.parse(exteriorRaw) : [];
      if (Array.isArray(exteriorList) && exteriorList.length > 0) {
        setExteriorConfigurations(exteriorList);
      } else {
        const preservedKey = `configs_preserved_${projectId}_Exterior`;
        const raw2 = typeof window !== 'undefined' ? localStorage.getItem(preservedKey) : null;
        const list2 = raw2 ? JSON.parse(raw2) : [];
        if (Array.isArray(list2) && list2.length > 0) {
          setExteriorConfigurations(list2);
        }
      }

      // Load Waterproofing configs
      const waterproofingKey = `paint_configs_${projectId}_Waterproofing`;
      const waterproofingRaw = typeof window !== 'undefined' ? localStorage.getItem(waterproofingKey) : null;
      const waterproofingList = waterproofingRaw ? JSON.parse(waterproofingRaw) : [];
      if (Array.isArray(waterproofingList) && waterproofingList.length > 0) {
        setWaterproofingConfigurations(waterproofingList);
      } else {
        const preservedKey = `configs_preserved_${projectId}_Waterproofing`;
        const raw2 = typeof window !== 'undefined' ? localStorage.getItem(preservedKey) : null;
        const list2 = raw2 ? JSON.parse(raw2) : [];
        if (Array.isArray(list2) && list2.length > 0) {
          setWaterproofingConfigurations(list2);
        }
      }
    } catch {} finally {
      // Mark localStorage hydration complete
      setLocalStorageHydrated(true);
    }
  }, [projectId]);

  // Custom sort function for product names to handle specific ordering requirements
  const sortProductNames = (names: string[]) => {
    return names.sort((a, b) => {
      // Special case: "Ultima" should come after "Ultima Stretch"
      if (a === "Ultima" && b === "Ultima Stretch") return 1;
      if (a === "Ultima Stretch" && b === "Ultima") return -1;
      // Default alphabetical sorting
      return a.localeCompare(b);
    });
  };

  // Optimized coverage data fetch - use prefetched data if available
  useEffect(() => {
    const loadCoverage = async () => {
      try {
        const data = await getOrFetchCoverageData();
        setCoverageData(data);
      } catch (err) {
        console.error('Error loading coverage data:', err);
      } finally {
        setCoverageLoaded(true);
      }
    };
    loadCoverage();
  }, []);

  // Fetch Enamel Primer and Apcolite Enamel products from product_pricing table
  useEffect(() => {
    const loadEnamelProducts = async () => {
      const {
        data: session
      } = await supabase.auth.getSession();
      if (!session?.session?.user?.id) return;

      // Fetch Enamel Primer products
      const {
        data: primerData,
        error: primerError
      } = await supabase.from('product_pricing').select('product_name').eq('user_id', session.session.user.id).eq('category', 'Enamel Primer').eq('is_visible', true).order('product_name');
      if (!primerError && primerData) {
        setEnamelPrimerProducts(primerData.map(p => p.product_name));
      }

      // Fetch Apcolite Enamel products
      const {
        data: enamelData,
        error: enamelError
      } = await supabase.from('product_pricing').select('product_name').eq('user_id', session.session.user.id).eq('category', 'Apcolite Enamel').eq('is_visible', true).order('product_name');
      if (!enamelError && enamelData) {
        setApcoliteEnamelProducts(enamelData.map(p => p.product_name));
      }
    };
    loadEnamelProducts();
  }, []);

  // PERFORMANCE: Non-blocking room loading - show UI immediately
  // CRITICAL: NO real-time subscription - it causes re-renders that lose input values
  useEffect(() => {
    if (!projectId) {
      setRoomsLoaded(true);
      return;
    }

    let isMounted = true;
    
    // PERFORMANCE: Schedule room loading after initial paint
    scheduleIdleTask(async () => {
      try {
        // Fetch rooms in background - UI already rendered
        const { data: freshRooms, error } = await supabase
          .from('rooms')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true });
          
        if (error) {
          console.error('Error fetching rooms:', error);
          if (isMounted) setRoomsLoaded(true);
          return;
        }
        
        if (isMounted && freshRooms) {
          // Use startTransition to make state update non-blocking
          startTransition(() => {
            setRooms(freshRooms);
            initialLoadDone.current = true;
            setRoomsLoaded(true);
          });
        }
      } catch (err) {
        console.error('Error in loadRooms:', err);
        if (isMounted) setRoomsLoaded(true);
      }
    });
      
    return () => {
      isMounted = false;
    };
  }, [projectId]);

  // Initialize configurations based on rooms
  const initializeConfigurations = (roomsData: any[]) => {
    const configs: AreaConfiguration[] = [];

    // Filter rooms by selected paint type
    const filteredRooms = roomsData.filter(room => {
      const projectType = room.project_type;
      if (selectedPaintType === "Interior") return projectType === "Interior";
      if (selectedPaintType === "Exterior") return projectType === "Exterior";
      if (selectedPaintType === "Waterproofing") return projectType === "Waterproofing";
      return false;
    });

    // Calculate totals for each area type and track which areas are selected
    let floorAreaTotal = 0;
    let wallAreaTotal = 0;
    let ceilingAreaTotal = 0;
    let enamelAreaTotal = 0;
    let hasFloorSelected = false;
    let hasWallSelected = false;
    let hasCeilingSelected = false;
    let hasEnamelSelected = false;

    // Separate rooms with section_name (they become independent config boxes)
    const regularRooms = filteredRooms.filter((room: any) => !room.section_name);
    const sectionRooms = filteredRooms.filter((room: any) => !!room.section_name);

    // Process regular rooms (merge into totals)
    regularRooms.forEach((room: any) => {
      // Use selected_areas from room - if null/undefined, default to wall:true only (standard paint job)
      // For new projects with empty rooms, this ensures only wall area is selected by default
      const selectedAreas = typeof room.selected_areas === 'object' && room.selected_areas !== null ? room.selected_areas as any : {
        floor: false,
        wall: true,
        ceiling: false
      };
      if (selectedAreas.floor) {
        floorAreaTotal += Number(room.floor_area || 0);
        hasFloorSelected = true;
      }
      if (selectedAreas.wall) {
        wallAreaTotal += Number(room.adjusted_wall_area || room.wall_area || 0);
        hasWallSelected = true;
      }
      if (selectedAreas.ceiling) {
        ceilingAreaTotal += Number(room.ceiling_area || 0);
        hasCeilingSelected = true;
      }
      // Enamel is ALWAYS included if door/window/grill areas exist with actual area
      // This is the single source of truth from Room Measurements - no filtering
      const enamelArea = Number(room.total_door_window_grill_area || 0);
      if (enamelArea > 0) {
        enamelAreaTotal += enamelArea;
        hasEnamelSelected = true;
      }

      // Process sub-areas (custom sections) as completely independent paintable sections
      // These are NOT merged with Wall Area - each is a separate paint configuration
      if (room.sub_areas && Array.isArray(room.sub_areas)) {
        room.sub_areas.forEach((subArea: any) => {
          // Include ALL custom sections, even those with area=0 (user will enter sq.ft later)
          configs.push({
            id: `subarea-${room.room_id}-${subArea.id}`,
            areaType: 'Wall' as const,
            paintingSystem: null,
            coatConfiguration: {
              putty: 0,
              primer: 0,
              emulsion: 0
            },
            repaintingConfiguration: {
              primer: 0,
              emulsion: 0
            },
            selectedMaterials: {
              putty: '',
              primer: '',
              emulsion: ''
            },
            area: Number(subArea.area) || 0,
            perSqFtRate: '',
            // Use only the section name as the label, not prefixed with room name
            label: subArea.name || 'Custom Section',
            isAdditional: false,
            isCustomSection: true,
            // Flag to identify custom sections
            roomId: room.room_id,
            subAreaId: subArea.id
          });
        });
      }
    });

    // Process rooms with section_name as completely independent configuration boxes
    sectionRooms.forEach((room: any) => {
      // Use selected_areas from room - if null/undefined, default to wall:true only
      const selectedAreas = typeof room.selected_areas === 'object' && room.selected_areas !== null ? room.selected_areas as any : {
        floor: false,
        wall: true,
        ceiling: false
      };
      const sectionLabel = room.section_name;
      // Prioritize section_name over room.name for display (user wants to see section name like "Varnish")
      const roomName = room.section_name || room.name || 'Room';

      // Create separate config boxes for each selected area type - show section name if exists
      if (selectedAreas.floor) {
        const floorArea = Number(room.floor_area || 0);
        configs.push({
          id: `section-floor-${room.room_id}`,
          areaType: 'Floor' as const,
          paintingSystem: null,
          coatConfiguration: {
            putty: 0,
            primer: 0,
            emulsion: 0
          },
          repaintingConfiguration: {
            primer: 0,
            emulsion: 0
          },
          selectedMaterials: {
            putty: '',
            primer: '',
            emulsion: ''
          },
          area: floorArea,
          perSqFtRate: '',
          label: roomName,
          isAdditional: false,
          isCustomSection: true,
          roomId: room.room_id
        });
      }
      if (selectedAreas.wall) {
        const wallArea = Number(room.adjusted_wall_area || room.wall_area || 0);
        configs.push({
          id: `section-wall-${room.room_id}`,
          areaType: 'Wall' as const,
          paintingSystem: null,
          coatConfiguration: {
            putty: 0,
            primer: 0,
            emulsion: 0
          },
          repaintingConfiguration: {
            primer: 0,
            emulsion: 0
          },
          selectedMaterials: {
            putty: '',
            primer: '',
            emulsion: ''
          },
          area: wallArea,
          perSqFtRate: '',
          label: roomName,
          isAdditional: false,
          isCustomSection: true,
          roomId: room.room_id
        });
      }
      if (selectedAreas.ceiling) {
        const ceilingArea = Number(room.ceiling_area || 0);
        configs.push({
          id: `section-ceiling-${room.room_id}`,
          areaType: 'Ceiling' as const,
          paintingSystem: null,
          coatConfiguration: {
            putty: 0,
            primer: 0,
            emulsion: 0
          },
          repaintingConfiguration: {
            primer: 0,
            emulsion: 0
          },
          selectedMaterials: {
            putty: '',
            primer: '',
            emulsion: ''
          },
          area: ceilingArea,
          perSqFtRate: '',
          label: roomName,
          isAdditional: false,
          isCustomSection: true,
          roomId: room.room_id
        });
      }

      // Enamel for section rooms - ALWAYS include if total_door_window_grill_area > 0
      const sectionEnamelArea = Number(room.total_door_window_grill_area || 0);
      if (sectionEnamelArea > 0) {
        configs.push({
          id: `section-enamel-${room.room_id}`,
          areaType: 'Enamel' as const,
          paintingSystem: null,
          coatConfiguration: {
            putty: 0,
            primer: 0,
            emulsion: 0
          },
          repaintingConfiguration: {
            primer: 0,
            emulsion: 0
          },
          selectedMaterials: {
            putty: '',
            primer: '',
            emulsion: ''
          },
          area: sectionEnamelArea,
          perSqFtRate: '',
          label: roomName,
          isAdditional: false,
          isCustomSection: true,
          roomId: room.room_id
        });
      }

      // Process sub-areas for section rooms
      if (room.sub_areas && Array.isArray(room.sub_areas)) {
        room.sub_areas.forEach((subArea: any) => {
          configs.push({
            id: `subarea-${room.room_id}-${subArea.id}`,
            areaType: 'Wall' as const,
            paintingSystem: null,
            coatConfiguration: {
              putty: 0,
              primer: 0,
              emulsion: 0
            },
            repaintingConfiguration: {
              primer: 0,
              emulsion: 0
            },
            selectedMaterials: {
              putty: '',
              primer: '',
              emulsion: ''
            },
            area: Number(subArea.area) || 0,
            perSqFtRate: '',
            label: subArea.name || 'Sub Area',
            isAdditional: false,
            isCustomSection: true,
            roomId: room.room_id,
            subAreaId: subArea.id
          });
        });
      }
    });

    // Check if we're in "additional area" mode to create new separate boxes
    const modeKey = `additional_mode_${projectId}_${selectedPaintType}`;
    const baselineKey = `additional_baseline_${projectId}_${selectedPaintType}`;
    const storedKey = `additional_entries_${projectId}_${selectedPaintType}`;
    const isAdditionalMode = typeof window !== 'undefined' && localStorage.getItem(modeKey) === '1';
    const baselineRaw = typeof window !== 'undefined' ? localStorage.getItem(baselineKey) : null;
    const baseline = baselineRaw ? JSON.parse(baselineRaw) as {
      floor?: number;
      wall?: number;
      ceiling?: number;
      enamel?: number;
      roomIds?: string[];
    } : null;

    // Load previously stored additional entries so we keep them across sessions
    let storedAdditional: AreaConfiguration[] = [];
    let storedList: any[] = [];
    try {
      const storedRaw = typeof window !== 'undefined' ? localStorage.getItem(storedKey) : null;
      storedList = storedRaw ? JSON.parse(storedRaw) : [];
      storedAdditional = (storedList || []).map((item: any) => ({
        id: item.id,
        areaType: item.areaType,
        paintingSystem: item.paintingSystem ?? null,
        coatConfiguration: item.coatConfiguration ?? {
          putty: 0,
          primer: 0,
          emulsion: 0
        },
        repaintingConfiguration: item.repaintingConfiguration ?? {
          primer: 0,
          emulsion: 0
        },
        selectedMaterials: item.selectedMaterials ?? {
          putty: '',
          primer: '',
          emulsion: ''
        },
        area: Number(item.area) || 0,
        perSqFtRate: item.perSqFtRate ?? '',
        label: item.label,
        isAdditional: true,
        enamelConfig: item.enamelConfig
      }));
    } catch {}

    // Main areas default to current totals (only if selected)
    let floorMain = hasFloorSelected ? floorAreaTotal : 0;
    let wallMain = hasWallSelected ? wallAreaTotal : 0;
    let ceilingMain = hasCeilingSelected ? ceilingAreaTotal : 0;
    let enamelMain = hasEnamelSelected ? enamelAreaTotal : 0;

    // Collect additional configs (new separate boxes)
    const additional: AreaConfiguration[] = [];

    // If NOT in additional mode, split totals into main + stored additionals (only for selected area types)
    if (!isAdditionalMode && storedAdditional.length > 0) {
      const sumStoredFloor = hasFloorSelected ? storedAdditional.filter(a => a.areaType === 'Floor').reduce((sum, a) => sum + (Number(a.area) || 0), 0) : 0;
      const sumStoredWall = hasWallSelected ? storedAdditional.filter(a => a.areaType === 'Wall').reduce((sum, a) => sum + (Number(a.area) || 0), 0) : 0;
      const sumStoredCeiling = hasCeilingSelected ? storedAdditional.filter(a => a.areaType === 'Ceiling').reduce((sum, a) => sum + (Number(a.area) || 0), 0) : 0;
      const sumStoredEnamel = hasEnamelSelected ? storedAdditional.filter(a => a.areaType === 'Enamel').reduce((sum, a) => sum + (Number(a.area) || 0), 0) : 0;
      floorMain = hasFloorSelected ? Math.max(0, floorAreaTotal - sumStoredFloor) : 0;
      wallMain = hasWallSelected ? Math.max(0, wallAreaTotal - sumStoredWall) : 0;
      ceilingMain = hasCeilingSelected ? Math.max(0, ceilingAreaTotal - sumStoredCeiling) : 0;
      enamelMain = hasEnamelSelected ? Math.max(0, enamelAreaTotal - sumStoredEnamel) : 0;
    }
    if (isAdditionalMode && baseline) {
      // Only calculate additional for area types that are selected
      const addFloor = hasFloorSelected ? Math.max(0, floorAreaTotal - (baseline.floor || 0)) : 0;
      const addWall = hasWallSelected ? Math.max(0, wallAreaTotal - (baseline.wall || 0)) : 0;
      const addCeiling = hasCeilingSelected ? Math.max(0, ceilingAreaTotal - (baseline.ceiling || 0)) : 0;

      // Keep main as baseline so the new difference becomes a new box (only for selected areas)
      floorMain = hasFloorSelected ? baseline.floor || 0 : 0;
      wallMain = hasWallSelected ? baseline.wall || 0 : 0;
      ceilingMain = hasCeilingSelected ? baseline.ceiling || 0 : 0;

      // Get the baseline room IDs to detect new rooms
      const baselineRoomIds = baseline.roomIds || [];
      const currentRoomIds = filteredRooms.map(r => r.id);
      const newRoomIds = currentRoomIds.filter(id => !baselineRoomIds.includes(id));

      // Find the newly added room(s)
      const newRooms = filteredRooms.filter(r => newRoomIds.includes(r.id));
      if (addFloor > 0) {
        // Get the room name from the newly added room with floor area
        let newRoomName = 'Additional Floor Area';
        const newFloorRoom = newRooms.find(room => {
          const selectedAreas = typeof room.selected_areas === 'object' && room.selected_areas !== null ? room.selected_areas as any : {
            floor: false,
            wall: false,
            ceiling: false
          };
          return selectedAreas.floor;
        });
        if (newFloorRoom) {
          newRoomName = `${newFloorRoom.name} (Floor Area)`;
        }
        const newConfig: AreaConfiguration = {
          id: `floor-additional-${Date.now()}`,
          areaType: 'Floor' as any,
          paintingSystem: null,
          coatConfiguration: {
            putty: 0,
            primer: 0,
            emulsion: 0
          },
          repaintingConfiguration: {
            primer: 0,
            emulsion: 0
          },
          selectedMaterials: {
            putty: '',
            primer: '',
            emulsion: ''
          },
          area: addFloor,
          perSqFtRate: '',
          label: newRoomName,
          isAdditional: true
        };
        additional.push(newConfig);
        try {
          storedList.push({
            ...newConfig
          });
          localStorage.setItem(storedKey, JSON.stringify(storedList));
        } catch {}
      }
      if (addWall > 0) {
        // Get the room name from the newly added room with wall area
        let newRoomName = 'Additional Wall Area';
        const newWallRoom = newRooms.find(room => {
          const selectedAreas = typeof room.selected_areas === 'object' && room.selected_areas !== null ? room.selected_areas as any : {
            floor: false,
            wall: false,
            ceiling: false
          };
          return selectedAreas.wall;
        });
        if (newWallRoom) {
          newRoomName = `${newWallRoom.name} (Wall Area)`;
        }
        const newConfig: AreaConfiguration = {
          id: `wall-additional-${Date.now()}`,
          areaType: 'Wall',
          paintingSystem: null,
          coatConfiguration: {
            putty: 0,
            primer: 0,
            emulsion: 0
          },
          repaintingConfiguration: {
            primer: 0,
            emulsion: 0
          },
          selectedMaterials: {
            putty: '',
            primer: '',
            emulsion: ''
          },
          area: addWall,
          perSqFtRate: '',
          label: newRoomName,
          isAdditional: true
        };
        additional.push(newConfig);
        try {
          storedList.push({
            ...newConfig
          });
          localStorage.setItem(storedKey, JSON.stringify(storedList));
        } catch {}
      }
      if (addCeiling > 0) {
        // Get the room name from the newly added room with ceiling area
        let newRoomName = 'Additional Ceiling Area';
        const newCeilingRoom = newRooms.find(room => {
          const selectedAreas = typeof room.selected_areas === 'object' && room.selected_areas !== null ? room.selected_areas as any : {
            floor: false,
            wall: false,
            ceiling: false
          };
          return selectedAreas.ceiling;
        });
        if (newCeilingRoom) {
          newRoomName = `${newCeilingRoom.name} (Ceiling Area)`;
        }
        const newConfig: AreaConfiguration = {
          id: `ceiling-additional-${Date.now()}`,
          areaType: 'Ceiling',
          paintingSystem: null,
          coatConfiguration: {
            putty: 0,
            primer: 0,
            emulsion: 0
          },
          repaintingConfiguration: {
            primer: 0,
            emulsion: 0
          },
          selectedMaterials: {
            putty: '',
            primer: '',
            emulsion: ''
          },
          area: addCeiling,
          perSqFtRate: '',
          label: newRoomName,
          isAdditional: true
        };
        additional.push(newConfig);
        try {
          storedList.push({
            ...newConfig
          });
          localStorage.setItem(storedKey, JSON.stringify(storedList));
        } catch {}
      }

      // Update baseline to new totals with room IDs and clear mode
      try {
        localStorage.setItem(baselineKey, JSON.stringify({
          floor: floorAreaTotal,
          wall: wallAreaTotal,
          ceiling: ceilingAreaTotal,
          enamel: enamelAreaTotal,
          roomIds: currentRoomIds
        }));
        localStorage.removeItem(modeKey);
      } catch {}
    } else if (!isAdditionalMode && baseline && baseline.roomIds && baseline.roomIds.length > 0) {
      // FALLBACK: If baseline exists and there are NEW rooms (not in baseline.roomIds),
      // create separate additional boxes automatically (even without the mode flag).
      // This ensures new sq.ft never disappears when user edits project.
      const baselineRoomIds = baseline.roomIds || [];
      const currentRoomIds = filteredRooms.map(r => r.id);
      const newRoomIds = currentRoomIds.filter(id => !baselineRoomIds.includes(id));
      if (newRoomIds.length > 0) {
        // New rooms detected! Calculate the difference (only for selected area types)
        const addFloor = hasFloorSelected ? Math.max(0, floorAreaTotal - (baseline.floor || 0)) : 0;
        const addWall = hasWallSelected ? Math.max(0, wallAreaTotal - (baseline.wall || 0)) : 0;
        const addCeiling = hasCeilingSelected ? Math.max(0, ceilingAreaTotal - (baseline.ceiling || 0)) : 0;

        // Keep main as baseline (only for selected area types)
        floorMain = hasFloorSelected ? baseline.floor || 0 : 0;
        wallMain = hasWallSelected ? baseline.wall || 0 : 0;
        ceilingMain = hasCeilingSelected ? baseline.ceiling || 0 : 0;
        const newRooms = filteredRooms.filter(r => newRoomIds.includes(r.id));
        if (addFloor > 0) {
          let newRoomName = 'Additional Floor Area';
          const newFloorRoom = newRooms.find(room => {
            const selectedAreas = typeof room.selected_areas === 'object' && room.selected_areas !== null ? room.selected_areas as any : {
              floor: false,
              wall: false,
              ceiling: false
            };
            return selectedAreas.floor;
          });
          if (newFloorRoom) {
            newRoomName = `${newFloorRoom.name} (Floor Area)`;
          }
          const newConfig: AreaConfiguration = {
            id: `floor-additional-${Date.now()}`,
            areaType: 'Floor' as any,
            paintingSystem: null,
            coatConfiguration: {
              putty: 0,
              primer: 0,
              emulsion: 0
            },
            repaintingConfiguration: {
              primer: 0,
              emulsion: 0
            },
            selectedMaterials: {
              putty: '',
              primer: '',
              emulsion: ''
            },
            area: addFloor,
            perSqFtRate: '',
            label: newRoomName,
            isAdditional: true
          };
          additional.push(newConfig);
          try {
            storedList.push({
              ...newConfig
            });
            localStorage.setItem(storedKey, JSON.stringify(storedList));
          } catch {}
        }
        if (addWall > 0) {
          let newRoomName = 'Additional Wall Area';
          const newWallRoom = newRooms.find(room => {
            const selectedAreas = typeof room.selected_areas === 'object' && room.selected_areas !== null ? room.selected_areas as any : {
              floor: false,
              wall: false,
              ceiling: false
            };
            return selectedAreas.wall;
          });
          if (newWallRoom) {
            newRoomName = `${newWallRoom.name} (Wall Area)`;
          }
          const newConfig: AreaConfiguration = {
            id: `wall-additional-${Date.now()}`,
            areaType: 'Wall',
            paintingSystem: null,
            coatConfiguration: {
              putty: 0,
              primer: 0,
              emulsion: 0
            },
            repaintingConfiguration: {
              primer: 0,
              emulsion: 0
            },
            selectedMaterials: {
              putty: '',
              primer: '',
              emulsion: ''
            },
            area: addWall,
            perSqFtRate: '',
            label: newRoomName,
            isAdditional: true
          };
          additional.push(newConfig);
          try {
            storedList.push({
              ...newConfig
            });
            localStorage.setItem(storedKey, JSON.stringify(storedList));
          } catch {}
        }
        if (addCeiling > 0) {
          let newRoomName = 'Additional Ceiling Area';
          const newCeilingRoom = newRooms.find(room => {
            const selectedAreas = typeof room.selected_areas === 'object' && room.selected_areas !== null ? room.selected_areas as any : {
              floor: false,
              wall: false,
              ceiling: false
            };
            return selectedAreas.ceiling;
          });
          if (newCeilingRoom) {
            newRoomName = `${newCeilingRoom.name} (Ceiling Area)`;
          }
          const newConfig: AreaConfiguration = {
            id: `ceiling-additional-${Date.now()}`,
            areaType: 'Ceiling',
            paintingSystem: null,
            coatConfiguration: {
              putty: 0,
              primer: 0,
              emulsion: 0
            },
            repaintingConfiguration: {
              primer: 0,
              emulsion: 0
            },
            selectedMaterials: {
              putty: '',
              primer: '',
              emulsion: ''
            },
            area: addCeiling,
            perSqFtRate: '',
            label: newRoomName,
            isAdditional: true
          };
          additional.push(newConfig);
          try {
            storedList.push({
              ...newConfig
            });
            localStorage.setItem(storedKey, JSON.stringify(storedList));
          } catch {}
        }

        // Update baseline to include new rooms
        try {
          localStorage.setItem(baselineKey, JSON.stringify({
            floor: floorAreaTotal,
            wall: wallAreaTotal,
            ceiling: ceilingAreaTotal,
            enamel: enamelAreaTotal,
            roomIds: currentRoomIds
          }));
        } catch {}
      }
    }

    // Check if we're in "additional enamel area" mode
    const enamelModeKey = `additional_enamel_mode_${projectId}_${selectedPaintType}`;
    const enamelBaselineKey = `additional_enamel_baseline_${projectId}_${selectedPaintType}`;
    const isAdditionalEnamelMode = typeof window !== 'undefined' && localStorage.getItem(enamelModeKey) === '1';
    const enamelBaselineRaw = typeof window !== 'undefined' ? localStorage.getItem(enamelBaselineKey) : null;
    const enamelBaseline = enamelBaselineRaw ? JSON.parse(enamelBaselineRaw) as {
      enamel?: number;
      roomIds?: string[];
    } : null;
    if (isAdditionalEnamelMode && enamelBaseline) {
      const addEnamel = Math.max(0, enamelAreaTotal - (enamelBaseline.enamel || 0));

      // Keep main enamel as baseline
      enamelMain = enamelBaseline.enamel || 0;

      // Get the baseline room IDs to detect new rooms
      const baselineRoomIds = enamelBaseline.roomIds || [];
      const currentRoomIds = filteredRooms.map(r => r.id);
      const newRoomIds = currentRoomIds.filter(id => !baselineRoomIds.includes(id));

      // Find the newly added room(s)
      const newRooms = filteredRooms.filter(r => newRoomIds.includes(r.id));
      if (addEnamel > 0) {
        // Get the section/room name from the newly added room with enamel area - prioritize section_name
        let newRoomName = 'Additional Enamel Area';
        const newEnamelRoom = newRooms.find(room => {
          return room.door_window_grills && Array.isArray(room.door_window_grills) && room.door_window_grills.length > 0;
        });
        if (newEnamelRoom) {
          // Prioritize section_name (e.g., "Varnish") over room.name (e.g., "Living Room")
          newRoomName = newEnamelRoom.section_name || newEnamelRoom.name || 'Additional Enamel Area';
        }
        const newConfig: AreaConfiguration = {
          id: `enamel-additional-${Date.now()}`,
          areaType: 'Enamel',
          paintingSystem: null,
          coatConfiguration: {
            putty: 0,
            primer: 0,
            emulsion: 0
          },
          repaintingConfiguration: {
            primer: 0,
            emulsion: 0
          },
          selectedMaterials: {
            putty: '',
            primer: '',
            emulsion: ''
          },
          label: newRoomName,
          area: addEnamel,
          perSqFtRate: '',
          isAdditional: true
        };
        additional.push(newConfig);
        try {
          storedList.push({
            ...newConfig
          });
          localStorage.setItem(storedKey, JSON.stringify(storedList));
        } catch {}
      }

      // Update baseline to new totals with room IDs and clear mode
      try {
        localStorage.setItem(enamelBaselineKey, JSON.stringify({
          enamel: enamelAreaTotal,
          roomIds: currentRoomIds
        }));
        localStorage.removeItem(enamelModeKey);
      } catch {}
    }

    // Create initial configurations only for areas that were selected and have actual sq.ft
    if (floorMain > 0 && hasFloorSelected) {
      configs.push({
        id: 'floor-main',
        areaType: 'Floor' as any,
        paintingSystem: null,
        coatConfiguration: {
          putty: 0,
          primer: 0,
          emulsion: 0
        },
        repaintingConfiguration: {
          primer: 0,
          emulsion: 0
        },
        selectedMaterials: {
          putty: '',
          primer: '',
          emulsion: ''
        },
        area: floorMain,
        perSqFtRate: '',
        label: 'Floor Area',
        isAdditional: false,
        areaPriority: 3 // Floor priority
      });
    }
    if (wallMain > 0 && hasWallSelected) {
      configs.push({
        id: 'wall-main',
        areaType: 'Wall',
        paintingSystem: null,
        coatConfiguration: {
          putty: 0,
          primer: 0,
          emulsion: 0
        },
        repaintingConfiguration: {
          primer: 0,
          emulsion: 0
        },
        selectedMaterials: {
          putty: '',
          primer: '',
          emulsion: ''
        },
        area: wallMain,
        perSqFtRate: '',
        label: 'Wall Area',
        isAdditional: false,
        areaPriority: 1 // Wall priority (highest for main areas)
      });
    }
    if (ceilingMain > 0 && hasCeilingSelected) {
      configs.push({
        id: 'ceiling-main',
        areaType: 'Ceiling',
        paintingSystem: null,
        coatConfiguration: {
          putty: 0,
          primer: 0,
          emulsion: 0
        },
        repaintingConfiguration: {
          primer: 0,
          emulsion: 0
        },
        selectedMaterials: {
          putty: '',
          primer: '',
          emulsion: ''
        },
        area: ceilingMain,
        perSqFtRate: '',
        label: 'Ceiling Area',
        isAdditional: false,
        areaPriority: 2 // Ceiling priority
      });
    }
    // FAIL-SAFE: Enamel MUST always appear if enamelAreaTotal > 0, regardless of hasEnamelSelected
    // This ensures enamel from Room Measurements ALWAYS shows in Paint Estimation
    const effectiveEnamelMain = enamelAreaTotal > 0 ? enamelMain > 0 ? enamelMain : enamelAreaTotal : 0;
    if (effectiveEnamelMain > 0) {
      configs.push({
        id: 'enamel-main',
        areaType: 'Enamel',
        paintingSystem: null,
        coatConfiguration: {
          putty: 0,
          primer: 0,
          emulsion: 0
        },
        repaintingConfiguration: {
          primer: 0,
          emulsion: 0
        },
        selectedMaterials: {
          putty: '',
          primer: '',
          emulsion: ''
        },
        area: effectiveEnamelMain,
        perSqFtRate: '',
        label: 'Enamel Area',
        isAdditional: false,
        areaPriority: 5 // Enamel priority (lowest)
      });
    }

    // Append any additional configs detected (persisted + new) but only keep area types that were SELECTED (not just > 0)
    // FAIL-SAFE: Enamel uses enamelAreaTotal > 0 check to ensure it's never filtered out incorrectly
    const filteredStored = storedAdditional.filter(a => {
      if (a.areaType === 'Floor') return hasFloorSelected;
      if (a.areaType === 'Wall') return hasWallSelected;
      if (a.areaType === 'Ceiling') return hasCeilingSelected;
      if (a.areaType === 'Enamel') return enamelAreaTotal > 0; // Use total, not hasEnamelSelected
      return true;
    });
    configs.push(...filteredStored, ...additional);

    // Merge with existing configurations to preserve user choices
    const existingConfigs = selectedPaintType === "Interior" ? interiorConfigurations : selectedPaintType === "Exterior" ? exteriorConfigurations : waterproofingConfigurations;
    if (existingConfigs.length > 0) {
      // Update areas only, preserve all user selections, but remove configs that no longer have area
      const updated = existingConfigs.map(existing => {
        const match = configs.find(cfg => cfg.id === existing.id || cfg.areaType === existing.areaType && cfg.label === existing.label && !!cfg.isAdditional === !!existing.isAdditional);
        return match ? {
          ...existing,
          area: match.area
        } : null;
      }).filter(Boolean) as AreaConfiguration[];

      // Add any new configs not in existing
      const newConfigs = configs.filter(cfg => !updated.some(u => u.id === cfg.id || u.areaType === cfg.areaType && u.label === cfg.label && !!u.isAdditional === !!cfg.isAdditional));
      setAreaConfigurations([...updated, ...newConfigs]);
    } else {
      // First time initialization - try to load from localStorage
      try {
        const preservedKey = `configs_preserved_${projectId}_${selectedPaintType}`;
        const raw = typeof window !== 'undefined' ? localStorage.getItem(preservedKey) : null;
        const preservedList = raw ? JSON.parse(raw) : [];
        if (preservedList.length > 0) {
          const merged = configs.map(cfg => {
            const match = preservedList.find((p: any) => p.id === cfg.id || p.areaType === cfg.areaType && p.label === cfg.label && !!p.isAdditional === !!cfg.isAdditional);
            return match ? {
              ...cfg,
              paintingSystem: match.paintingSystem ?? cfg.paintingSystem,
              coatConfiguration: match.coatConfiguration ?? cfg.coatConfiguration,
              repaintingConfiguration: match.repaintingConfiguration ?? cfg.repaintingConfiguration,
              selectedMaterials: match.selectedMaterials ?? cfg.selectedMaterials,
              perSqFtRate: match.perSqFtRate ?? cfg.perSqFtRate,
              enamelConfig: match.enamelConfig ?? cfg.enamelConfig
            } : cfg;
          });
          setAreaConfigurations(merged);
        } else {
          setAreaConfigurations(configs);
        }
      } catch {
        setAreaConfigurations(configs);
      }
    }
  };

  // Track previous rooms hash to prevent unnecessary re-initialization
  const prevRoomsHashRef = useRef<string>('');
  const prevPaintTypeRef = useRef<string>('');
  
  // PERFORMANCE: Non-blocking configuration initialization
  // Re-initialize when rooms change or paint type changes - ONLY after dataReady
  useEffect(() => {
    if (rooms.length > 0 && dataReady) {
      // Create a simple hash of room IDs and areas to detect actual data changes
      const roomsHash = rooms.map(r => `${r.id}-${r.floor_area}-${r.wall_area}-${r.ceiling_area}`).join('|');
      
      // Only re-initialize if rooms actually changed OR paint type changed
      // This prevents input loss during real-time subscription pings
      if (roomsHash !== prevRoomsHashRef.current || selectedPaintType !== prevPaintTypeRef.current) {
        prevRoomsHashRef.current = roomsHash;
        prevPaintTypeRef.current = selectedPaintType;
        
        // PERFORMANCE: Show calculating state briefly, then run in background
        setConfigsCalculating(true);
        
        // Use startTransition to make heavy calculation non-blocking
        startTransition(() => {
          try {
            initializeConfigurations(rooms);
          } catch (error) {
            console.error('Calculation error:', error);
          } finally {
            setConfigsCalculating(false);
          }
        });
      }
    }
  }, [rooms, selectedPaintType, dataReady]);

  // Persist configurations so they survive navigation and reload
  useEffect(() => {
    try {
      // Save Interior configs
      if (interiorConfigurations.length > 0) {
        const preservedKey = `configs_preserved_${projectId}_Interior`;
        const toStore = interiorConfigurations.map(c => ({
          id: c.id,
          areaType: c.areaType,
          paintingSystem: c.paintingSystem,
          coatConfiguration: c.coatConfiguration,
          repaintingConfiguration: c.repaintingConfiguration,
          selectedMaterials: c.selectedMaterials,
          perSqFtRate: c.perSqFtRate,
          label: c.label,
          isAdditional: c.isAdditional,
          enamelConfig: c.enamelConfig
        }));
        localStorage.setItem(preservedKey, JSON.stringify(toStore));
      }

      // Save Exterior configs
      if (exteriorConfigurations.length > 0) {
        const preservedKey = `configs_preserved_${projectId}_Exterior`;
        const toStore = exteriorConfigurations.map(c => ({
          id: c.id,
          areaType: c.areaType,
          paintingSystem: c.paintingSystem,
          coatConfiguration: c.coatConfiguration,
          repaintingConfiguration: c.repaintingConfiguration,
          selectedMaterials: c.selectedMaterials,
          perSqFtRate: c.perSqFtRate,
          label: c.label,
          isAdditional: c.isAdditional,
          enamelConfig: c.enamelConfig
        }));
        localStorage.setItem(preservedKey, JSON.stringify(toStore));
      }

      // Save Waterproofing configs
      if (waterproofingConfigurations.length > 0) {
        const preservedKey = `configs_preserved_${projectId}_Waterproofing`;
        const toStore = waterproofingConfigurations.map(c => ({
          id: c.id,
          areaType: c.areaType,
          paintingSystem: c.paintingSystem,
          coatConfiguration: c.coatConfiguration,
          repaintingConfiguration: c.repaintingConfiguration,
          selectedMaterials: c.selectedMaterials,
          perSqFtRate: c.perSqFtRate,
          label: c.label,
          isAdditional: c.isAdditional,
          enamelConfig: c.enamelConfig
        }));
        localStorage.setItem(preservedKey, JSON.stringify(toStore));
      }
    } catch {}
  }, [interiorConfigurations, exteriorConfigurations, waterproofingConfigurations, projectId]);

  // PERFORMANCE: Progressive rendering - gradually show more config cards
  useEffect(() => {
    const totalConfigs = areaConfigurations.length;
    if (totalConfigs === 0 || configsCalculating) {
      setVisibleConfigCount(4); // Reset to default
      return;
    }
    
    // If all configs fit in initial batch, show them all
    if (totalConfigs <= 4) {
      setVisibleConfigCount(totalConfigs);
      return;
    }
    
    // Progressive reveal: show 4 more configs every 50ms until all visible
    let currentVisible = 4;
    const revealMore = () => {
      if (currentVisible < totalConfigs) {
        currentVisible = Math.min(currentVisible + 4, totalConfigs);
        setVisibleConfigCount(currentVisible);
        if (currentVisible < totalConfigs) {
          scheduleIdleTask(revealMore);
        }
      }
    };
    
    scheduleIdleTask(revealMore);
  }, [areaConfigurations.length, configsCalculating]);

  // Sync estimation data to localStorage whenever configurations change
  useEffect(() => {
    try {
      const updatedData = {
        interiorConfigurations,
        exteriorConfigurations,
        waterproofingConfigurations,
        lastPaintType: selectedPaintType
      };
      localStorage.setItem(`estimation_${projectId}`, JSON.stringify(updatedData));
    } catch {}
  }, [interiorConfigurations, exteriorConfigurations, waterproofingConfigurations, selectedPaintType, projectId]);

  // Handle edit configuration
  const handleEditConfig = (configId: string) => {
    setSelectedConfigId(configId);
    setDialogOpen(true);
  };

  // Handle delete configuration
  const handleDeleteConfig = (configId: string) => {
    // Find the config to check if it's a custom section
    const configToDelete = areaConfigurations.find(c => c.id === configId);
    setAreaConfigurations(prev => prev.filter(config => config.id !== configId));
    try {
      const storedKey = `additional_entries_${projectId}_${selectedPaintType}`;
      const raw = localStorage.getItem(storedKey);
      const list = raw ? JSON.parse(raw) : [];
      const updated = Array.isArray(list) ? list.filter((item: any) => item.id !== configId) : [];
      localStorage.setItem(storedKey, JSON.stringify(updated));
    } catch {}

    // If it's a custom section, also delete from database
    if (configToDelete?.isCustomSection && configToDelete?.roomId && configToDelete?.subAreaId) {
      const room = rooms.find(r => r.room_id === configToDelete.roomId);
      if (room && room.sub_areas) {
        const updatedSubAreas = (room.sub_areas as any[]).filter((sa: any) => sa.id !== configToDelete.subAreaId);
        supabase.from('rooms').update({
          sub_areas: updatedSubAreas
        }).eq('room_id', configToDelete.roomId).then(({
          error
        }) => {
          if (error) console.error('Error deleting custom section from database:', error);
        });
      }
    }
    toast.success('Configuration deleted');
  };

  // Handle update configuration
  const handleUpdateConfig = (updates: Partial<AreaConfiguration>) => {
    if (!selectedConfigId) return;
    setAreaConfigurations(prev => {
      const updated = prev.map(config => config.id === selectedConfigId ? {
        ...config,
        ...updates
      } : config);
      // Save to localStorage
      const savedConfigKey = `paint_configs_${projectId}_${selectedPaintType}`;
      try {
        localStorage.setItem(savedConfigKey, JSON.stringify(updated));
      } catch (e) {
        console.error('Error saving configs:', e);
      }
      return updated;
    });
  };

  // Handle add additional area (for enamel from dialog)
  const handleOpenAddAdditionalDialog = (areaType: 'Enamel') => {
    const newConfig: AreaConfiguration = {
      id: `${areaType.toLowerCase()}-additional-${Date.now()}`,
      areaType: areaType,
      paintingSystem: null,
      coatConfiguration: {
        putty: 0,
        primer: 0,
        emulsion: 0
      },
      repaintingConfiguration: {
        primer: 0,
        emulsion: 0
      },
      selectedMaterials: {
        putty: '',
        primer: '',
        emulsion: ''
      },
      area: 0,
      perSqFtRate: '',
      label: `Additional ${areaType} Area`,
      isAdditional: true
    };
    setAreaConfigurations(prev => [...prev, newConfig]);
    // Open config dialog immediately
    setTimeout(() => {
      setSelectedConfigId(newConfig.id);
      setDialogOpen(true);
    }, 100);
  };

  // Get selected configuration
  const selectedConfig = areaConfigurations.find(c => c.id === selectedConfigId);

  // Calculate total cost - sum of all area costs (emulsion + enamel)
  const calculateTotalCost = () => {
    return areaConfigurations.reduce((total, config) => {
      // For each area configuration (Floor, Wall, Ceiling, Enamel)
      // Calculate: area × rate per sq ft, then add to total
      if (config.perSqFtRate && config.area) {
        const areaCost = config.area * parseFloat(config.perSqFtRate);
        return total + areaCost;
      }
      return total;
    }, 0);
  };

  // Calculate total area for all paint areas (Floor, Wall, Ceiling, and Custom Sections)
  const getTotalPaintArea = () => {
    return areaConfigurations.filter(c => c.areaType === 'Floor' || c.areaType === 'Wall' || c.areaType === 'Ceiling').reduce((total, config) => total + (config.area || 0), 0);
  };
  const handleSaveProject = async () => {
    // Validate at least one configuration is complete across all paint types
    const allConfigs = [...interiorConfigurations, ...exteriorConfigurations, ...waterproofingConfigurations];
    const hasValidConfig = allConfigs.some(config => config.paintingSystem && config.perSqFtRate);
    if (!hasValidConfig) {
      toast.error('Please configure at least one area with painting system and rate');
      return;
    }
    try {
      setIsCalculating(true);

      // Save configurations to cache
      const updatedData = {
        interiorConfigurations: interiorConfigurations,
        exteriorConfigurations: exteriorConfigurations,
        waterproofingConfigurations: waterproofingConfigurations,
        lastPaintType: selectedPaintType,
        totalCost: calculateTotalCost()
      };
      localStorage.setItem(`estimation_${projectId}`, JSON.stringify(updatedData));

      const {
        data: {
          session
        }
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Please log in to save the project');
        setIsCalculating(false);
        return;
      }

      // Update project status to completed
      const { error: updateError } = await supabase
        .from('projects')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', projectId)
        .eq('user_id', session.user.id);

      if (updateError) {
        console.error('Error updating project:', updateError);
        toast.error('Failed to save project');
        setIsCalculating(false);
        return;
      }

      // Store paint configurations in the project
      const { error: configError } = await supabase
        .from('projects')
        .update({
          paint_configurations: updatedData
        })
        .eq('id', projectId)
        .eq('user_id', session.user.id);

      if (configError) {
        console.warn('Warning: Failed to store paint configurations:', configError);
      }

      setIsCalculating(false);
      toast.success('Project saved successfully!');

      // Navigate to dashboard
      navigate('/dashboard');
    } catch (error: any) {
      console.error('Error saving project:', error);
      setIsCalculating(false);
      toast.error(error.message || 'Failed to save project');
    }
  };

  // Separate configurations by type
  const floorConfigs = areaConfigurations.filter(c => c.areaType === 'Floor' && !c.isCustomSection);
  const wallConfigs = areaConfigurations.filter(c => c.areaType === 'Wall' && !c.isCustomSection);
  const ceilingConfigs = areaConfigurations.filter(c => c.areaType === 'Ceiling' && !c.isCustomSection);
  const enamelConfigs = areaConfigurations.filter(c => c.areaType === 'Enamel');
  // Custom sections created via (+) icon - completely separate from Wall Area, exclude Enamel types
  const customSectionConfigs = areaConfigurations.filter(c => c.isCustomSection && c.areaType !== 'Enamel');

  // Get configuration description
  const getConfigDescription = (config: AreaConfiguration) => {
    // Enamel summary
    if (config.areaType === 'Enamel' && config.enamelConfig) {
      const parts: string[] = [];
      if (config.enamelConfig.primerCoats > 0 && config.enamelConfig.primerType) {
        parts.push(`${config.enamelConfig.primerCoats} coat${config.enamelConfig.primerCoats > 1 ? 's' : ''} of ${config.enamelConfig.primerType} Primer`);
      }
      if (config.enamelConfig.enamelCoats > 0 && config.enamelConfig.enamelType) {
        parts.push(`${config.enamelConfig.enamelCoats} coat${config.enamelConfig.enamelCoats > 1 ? 's' : ''} of ${config.enamelConfig.enamelType} Enamel`);
      }
      return parts.join(' + ');
    }
    if (!config.paintingSystem) return '';
    const parts: string[] = [];
    if (config.paintingSystem === "Fresh Painting") {
      if (config.coatConfiguration.putty > 0 && config.selectedMaterials.putty) {
        parts.push(`${config.coatConfiguration.putty} coats of ${config.selectedMaterials.putty}`);
      }
      if (config.coatConfiguration.primer > 0 && config.selectedMaterials.primer) {
        parts.push(`${config.coatConfiguration.primer} coats of ${config.selectedMaterials.primer}`);
      }
      if (config.coatConfiguration.emulsion > 0 && config.selectedMaterials.emulsion) {
        parts.push(`${config.coatConfiguration.emulsion} coats of ${config.selectedMaterials.emulsion}`);
      }
    } else {
      if (config.repaintingConfiguration.primer > 0 && config.selectedMaterials.primer) {
        parts.push(`${config.repaintingConfiguration.primer} coats of ${config.selectedMaterials.primer}`);
      }
      if (config.repaintingConfiguration.emulsion > 0 && config.selectedMaterials.emulsion) {
        parts.push(`${config.repaintingConfiguration.emulsion} coats of ${config.selectedMaterials.emulsion}`);
      }
    }
    return parts.join(' + ');
  };
  return <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="eca-gradient text-white p-4">
        <div className="flex items-center space-x-3">
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={() => navigate(`/room-measurement/${projectId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Paint Estimation</h1>
            <p className="text-white/80 text-sm">Configure paint & calculate cost</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6 pb-24">
        {/* Paint Type Selection */}
        <Card className="eca-shadow">
          <CardHeader>
            <CardTitle className="flex items-center text-lg">
              <Palette className="mr-2 h-5 w-5 text-primary" />
              Paint Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2">
              <Button variant={selectedPaintType === "Interior" ? "default" : "outline"} onClick={() => setSelectedPaintType("Interior")} className="h-12 px-2 overflow-hidden whitespace-nowrap text-ellipsis text-center" style={{
              fontSize: 'clamp(12px, 3vw, 16px)'
            }}>
                Interior Paint
              </Button>
              <Button variant={selectedPaintType === "Exterior" ? "default" : "outline"} onClick={() => setSelectedPaintType("Exterior")} className="h-12 px-2 overflow-hidden whitespace-nowrap text-ellipsis text-center" style={{
              fontSize: 'clamp(12px, 3vw, 16px)'
            }}>
                Exterior Paint
              </Button>
              <Button variant={selectedPaintType === "Waterproofing" ? "default" : "outline"} onClick={() => setSelectedPaintType("Waterproofing")} className="h-12 px-2 overflow-hidden whitespace-nowrap text-ellipsis text-center" style={{
              fontSize: 'clamp(12px, 3vw, 16px)'
            }}>
                Waterproofing
              </Button>
            </div>
          </CardContent>
        </Card>
        
        {/* PERFORMANCE: Skeleton loading while configs calculate */}
        {configsCalculating && (
          <Card className="eca-shadow border-2 border-primary/30">
            <CardHeader>
              <CardTitle className="text-lg">Loading Configurations...</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[1, 2, 3].map(i => (
                <Card key={i} className="border-2 border-primary/10 bg-primary/5">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-5 w-32" />
                      <div className="flex gap-2">
                        <Skeleton className="h-8 w-8 rounded" />
                        <Skeleton className="h-8 w-8 rounded" />
                      </div>
                    </div>
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-10 w-full" />
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Paint Configuration Summary - SORTED BY areaPriority: Wall(1) → Ceiling(2) → Floor(3) → Separate(4) */}
        {!configsCalculating && visibleConfigurations.some(c => (c.paintingSystem || c.areaType === 'Enamel') && c.areaType !== 'Enamel') && <Card className="eca-shadow border-2 border-primary/30">
                <CardHeader>
                  <CardTitle className="text-lg">Paint Configuration Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {visibleConfigurations.filter(c => (c.paintingSystem || c.areaType === 'Enamel') && c.areaType !== 'Enamel').map(config => <Card key={config.id} className="border-2 border-primary/20 bg-primary/5">
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-base">{config.label}</h3>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/20" onClick={() => handleDeleteConfig(config.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditConfig(config.id)}>
                                <Settings className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Paint Type</p>
                            <p className="font-medium">{config.selectedMaterials.emulsion || 'Not Selected'}</p>
                          </div>
                          
                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Painting System</p>
                            <p className="font-medium">{config.paintingSystem}</p>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Coats</p>
                            <p className="font-medium text-sm leading-relaxed">
                              {getConfigDescription(config) || 'Not configured'}
                            </p>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Area Sq.ft</p>
                            <p className="font-medium">{config.area ? config.area.toFixed(2) : '0.00'}</p>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm">Per Sq.ft Rate (₹)</Label>
                            <RateInput 
                              placeholder="Enter rate per sq.ft" 
                              value={config.perSqFtRate} 
                              onChange={(newValue) => {
                                setAreaConfigurations(prev => {
                                  const updated = prev.map(c => c.id === config.id ? {
                                    ...c,
                                    perSqFtRate: newValue
                                  } : c);
                                  // Save to localStorage on blur (when RateInput calls onChange)
                                  const savedConfigKey = `paint_configs_${projectId}_${selectedPaintType}`;
                                  try {
                                    localStorage.setItem(savedConfigKey, JSON.stringify(updated));
                                  } catch (e) {
                                    console.error('Error saving configs:', e);
                                  }
                                  return updated;
                                });
                              }} 
                              className="h-10" 
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>)}
                </CardContent>
              </Card>}

            {/* Area to be Painted Section */}
            {(floorConfigs.length > 0 || wallConfigs.length > 0 || ceilingConfigs.length > 0 || customSectionConfigs.length > 0) && <div className="space-y-4">
                <h2 className="text-lg font-semibold">Area to be Painted</h2>
                
                {/* Main Floor, Wall and Ceiling Areas - Clickable Cards */}
                <div className="grid grid-cols-2 gap-4">
                  {floorConfigs.filter(c => !c.isAdditional).map(config => <div key={config.id} className={`border-2 border-dashed rounded-lg p-4 text-center space-y-2 cursor-pointer transition-all ${config.paintingSystem ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`} onClick={() => handleEditConfig(config.id)}>
                      <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 pointer-events-none">
                        {config.paintingSystem ? config.paintingSystem : 'Select System'}
                      </Button>
                      <div>
                        <p className="text-3xl font-bold">{config.area ? config.area.toFixed(1) : '0.0'}</p>
                        <p className="text-sm text-muted-foreground">{config.label}</p>
                      </div>
                    </div>)}
                  
                  {wallConfigs.filter(c => !c.isAdditional).map(config => <div key={config.id} className={`border-2 border-dashed rounded-lg p-4 text-center space-y-2 cursor-pointer transition-all ${config.paintingSystem ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`} onClick={() => handleEditConfig(config.id)}>
                      <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 pointer-events-none">
                        {config.paintingSystem ? config.paintingSystem : 'Select System'}
                      </Button>
                      <div>
                        <p className="text-3xl font-bold">{config.area ? config.area.toFixed(1) : '0.0'}</p>
                        <p className="text-sm text-muted-foreground">{config.label}</p>
                      </div>
                    </div>)}
                  
                  {ceilingConfigs.filter(c => !c.isAdditional).map(config => <div key={config.id} className={`border-2 border-dashed rounded-lg p-4 text-center space-y-2 cursor-pointer transition-all ${config.paintingSystem ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`} onClick={() => handleEditConfig(config.id)}>
                      <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 pointer-events-none">
                        {config.paintingSystem ? config.paintingSystem : 'Select System'}
                      </Button>
                      <div>
                        <p className="text-3xl font-bold">{config.area ? config.area.toFixed(1) : '0.0'}</p>
                        <p className="text-sm text-muted-foreground">{config.label}</p>
                      </div>
                    </div>)}
                </div>

                {/* Additional Floor, Wall and Ceiling Areas - Compact Half-Width Layout */}
                {[...floorConfigs, ...wallConfigs, ...ceilingConfigs].filter(c => c.isAdditional).length > 0 && <div className="grid grid-cols-2 gap-4">
                    {[...floorConfigs, ...wallConfigs, ...ceilingConfigs].filter(c => c.isAdditional).map(config => <div key={config.id} className={`border-2 border-dashed rounded-lg p-3 text-center space-y-2 cursor-pointer transition-all relative ${config.paintingSystem ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`} onClick={() => handleEditConfig(config.id)}>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive absolute top-2 right-2" onClick={e => {
              e.stopPropagation();
              handleDeleteConfig(config.id);
            }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 text-xs pointer-events-none">
                          {config.paintingSystem || 'Select System'}
                        </Button>
                        <div>
                          <p className="text-2xl font-bold">{config.area ? config.area.toFixed(1) : '0.0'}</p>
                          <p className="text-xs text-muted-foreground">{config.label}</p>
                        </div>
                      </div>)}
                  </div>}

                {/* Custom Sections - Separate Paint Areas created via (+) icon in Room Measurements */}
                {customSectionConfigs.length > 0 && <div className="space-y-3">
                    <h3 className="text-base font-semibold text-primary">Separate Paint Area</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {customSectionConfigs.map(config => {
              // Show section name user typed, not room name
              const room = rooms.find(r => r.room_id === config.roomId);
              const displayName = room?.section_name || config.label || 'Section';
              return <div key={config.id} className={`border-2 border-dashed rounded-lg p-4 text-center space-y-2 cursor-pointer transition-all relative ${config.paintingSystem ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`} onClick={() => handleEditConfig(config.id)}>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive absolute top-2 right-2" onClick={e => {
                  e.stopPropagation();
                  handleDeleteConfig(config.id);
                }}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 text-xs pointer-events-none">
                              {config.paintingSystem || 'Select System'}
                            </Button>
                            <p className="text-2xl font-bold">{config.area ? config.area.toFixed(1) : '0.0'}</p>
                            <p className="text-xs text-muted-foreground">{displayName}</p>
                          </div>;
            })}
                    </div>
                  </div>}

                {/* Total Area Summary */}
                <div className="bg-destructive/10 border-l-4 border-destructive rounded-lg p-4 text-center">
                  <p className="text-destructive font-medium mb-1">Total Area</p>
                  <p className="text-2xl font-bold">{getTotalPaintArea().toFixed(1)} sq.ft</p>
                </div>

                {/* Add Additional Square Footage - Navigate to Room Measurement */}
                <Button variant="outline" className="w-full border-dashed" onClick={() => {
          try {
            // Baseline must include ALL existing areas (main + previous additionals)
            const floorBase = floorConfigs.reduce((sum, c) => sum + c.area, 0);
            const wallBase = wallConfigs.reduce((sum, c) => sum + c.area, 0);
            const ceilingBase = ceilingConfigs.reduce((sum, c) => sum + c.area, 0);
            const enamelBase = enamelConfigs.reduce((sum, c) => sum + c.area, 0);
            // Store current room IDs to detect new rooms later
            const currentRoomIds = rooms.filter(room => {
              const projectType = room.project_type;
              if (selectedPaintType === "Interior") return projectType === "Interior";
              if (selectedPaintType === "Exterior") return projectType === "Exterior";
              if (selectedPaintType === "Waterproofing") return projectType === "Waterproofing";
              return false;
            }).map(r => r.id);
            localStorage.setItem(`additional_baseline_${projectId}_${selectedPaintType}`, JSON.stringify({
              floor: floorBase,
              wall: wallBase,
              ceiling: ceilingBase,
              enamel: enamelBase,
              roomIds: currentRoomIds
            }));
            localStorage.setItem(`additional_mode_${projectId}_${selectedPaintType}`, '1');
          } catch {}
          navigate(`/room-measurement/${projectId}`);
        }}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Additional Sq.ft Area
                </Button>
              </div>}

            {/* Enamel Paint Configuration Summary - Moved above Door & Window Enamel */}
            {areaConfigurations.some(c => c.areaType === 'Enamel' && (c.paintingSystem || c.enamelConfig)) && <Card className="eca-shadow border-2 border-orange-500/30">
                <CardHeader>
                  <CardTitle className="text-lg text-orange-700 dark:text-orange-300">Enamel Paint Configuration Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Main Enamel Areas first (non-custom sections) */}
                  {areaConfigurations.filter(c => c.areaType === 'Enamel' && (c.paintingSystem || c.enamelConfig) && !c.isCustomSection).map(config => <Card key={config.id} className="border-2 border-orange-500/20 bg-orange-50/50 dark:bg-orange-950/20">
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-base text-orange-700 dark:text-orange-300">{config.label}</h3>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/20" onClick={() => handleDeleteConfig(config.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditConfig(config.id)}>
                                <Settings className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Paint Type</p>
                            <p className="font-medium">{config.enamelConfig?.enamelType || 'Not Selected'}</p>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Painting System</p>
                            <p className="font-medium">{config.paintingSystem || 'Not Selected'}</p>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Coats</p>
                            <p className="font-medium text-sm leading-relaxed">
                              {getConfigDescription(config) || 'Not configured'}
                            </p>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Area Sq.ft</p>
                            <p className="font-medium">{config.area ? config.area.toFixed(2) : '0.00'}</p>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm">Per Sq.ft Rate (₹)</Label>
                            <RateInput 
                              placeholder="Enter rate per sq.ft" 
                              value={config.perSqFtRate} 
                              onChange={(newValue) => {
                                setAreaConfigurations(prev => {
                                  const updated = prev.map(c => c.id === config.id ? {
                                    ...c,
                                    perSqFtRate: newValue
                                  } : c);
                                  // Save to localStorage on blur
                                  const savedConfigKey = `paint_configs_${projectId}_${selectedPaintType}`;
                                  try {
                                    localStorage.setItem(savedConfigKey, JSON.stringify(updated));
                                  } catch (e) {
                                    console.error('Error saving configs:', e);
                                  }
                                  return updated;
                                });
                              }} 
                              className="h-10" 
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>)}
                  
                  {/* Separate Enamel Areas (custom sections) - shown after main enamel */}
                  {areaConfigurations.filter(c => c.areaType === 'Enamel' && (c.paintingSystem || c.enamelConfig) && c.isCustomSection).map(config => {
            const room = rooms.find(r => r.room_id === config.roomId);
            const displayName = room?.section_name || config.label || 'Section';
            return <Card key={config.id} className="border-2 border-orange-500/20 bg-orange-50/50 dark:bg-orange-950/20">
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-base text-orange-700 dark:text-orange-300">{displayName}</h3>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/20" onClick={() => handleDeleteConfig(config.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditConfig(config.id)}>
                                <Settings className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Paint Type</p>
                            <p className="font-medium">{config.enamelConfig?.enamelType || 'Not Selected'}</p>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Painting System</p>
                            <p className="font-medium">{config.paintingSystem || 'Not Selected'}</p>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Coats</p>
                            <p className="font-medium text-sm leading-relaxed">
                              {getConfigDescription(config) || 'Not configured'}
                            </p>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">Area Sq.ft</p>
                            <p className="font-medium">{config.area ? config.area.toFixed(2) : '0.00'}</p>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm">Per Sq.ft Rate (₹)</Label>
                            <RateInput 
                              placeholder="Enter rate per sq.ft" 
                              value={config.perSqFtRate} 
                              onChange={(newValue) => {
                                setAreaConfigurations(prev => {
                                  const updated = prev.map(c => c.id === config.id ? {
                                    ...c,
                                    perSqFtRate: newValue
                                  } : c);
                                  // Save to localStorage on blur
                                  const savedConfigKey = `paint_configs_${projectId}_${selectedPaintType}`;
                                  try {
                                    localStorage.setItem(savedConfigKey, JSON.stringify(updated));
                                  } catch (e) {
                                    console.error('Error saving configs:', e);
                                  }
                                  return updated;
                                });
                              }} 
                              className="h-10" 
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>;
          })}
                </CardContent>
              </Card>}

            {/* Door & Window Enamel Section */}
            {enamelConfigs.length > 0 && <div className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center">
                  <Settings className="mr-2 h-5 w-5 text-primary" />
                  Door & Window Enamel
                </h2>
                
                {/* Main Enamel Areas (non-custom sections) */}
                {enamelConfigs.filter(c => !c.isCustomSection).length > 0 && <div className="grid grid-cols-2 gap-4">
                  {enamelConfigs.filter(c => !c.isCustomSection).map(config => {
                    const room = rooms.find(r => r.room_id === config.roomId);
                    // Prioritize section_name (e.g., "Varnish") over config.label/room.name
                    const displayName = room?.section_name || config.label || 'Enamel Area';
                    return <div key={config.id} className={`border-2 border-dashed rounded-lg p-4 text-center space-y-2 cursor-pointer transition-all relative ${config.paintingSystem ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/20' : 'border-orange-300 hover:border-orange-500 bg-orange-50/30 dark:bg-orange-950/10'}`} onClick={() => handleEditConfig(config.id)}>
                      {config.isAdditional && <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive absolute top-2 right-2" onClick={e => {
                        e.stopPropagation();
                        handleDeleteConfig(config.id);
                      }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>}
                      <Button variant="ghost" size="sm" className="text-orange-700 dark:text-orange-300 text-xs pointer-events-none">
                        {config.paintingSystem || 'Configure Enamel'}
                      </Button>
                      <div>
                        <p className="text-3xl font-bold text-orange-700 dark:text-orange-300">{config.area ? config.area.toFixed(1) : '0.0'}</p>
                        <p className="text-sm text-orange-600 dark:text-orange-400">
                          {displayName}
                        </p>
                      </div>
                    </div>;
                  })}
                </div>}

                {/* Separate Enamel Area - Custom sections with section_name */}
                {enamelConfigs.filter(c => c.isCustomSection).length > 0 && <div className="space-y-3">
                    <h3 className="text-base font-semibold text-orange-700 dark:text-orange-300">Separate Enamel Area</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {enamelConfigs.filter(c => c.isCustomSection).map(config => {
              const room = rooms.find(r => r.room_id === config.roomId);
              // Show section name user typed, not room name
              const displayName = room?.section_name || config.label || 'Section';
              return <div key={config.id} className={`border-2 border-dashed rounded-lg p-4 text-center space-y-2 cursor-pointer transition-all relative ${config.paintingSystem ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/20' : 'border-orange-300 hover:border-orange-500 bg-orange-50/30 dark:bg-orange-950/10'}`} onClick={() => handleEditConfig(config.id)}>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive absolute top-2 right-2" onClick={e => {
                  e.stopPropagation();
                  handleDeleteConfig(config.id);
                }}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-orange-700 dark:text-orange-300 text-xs pointer-events-none">
                              {config.paintingSystem || 'Configure Enamel'}
                            </Button>
                            <p className="text-3xl font-bold text-orange-700 dark:text-orange-300">{config.area ? config.area.toFixed(1) : '0.0'}</p>
                            <p className="text-sm text-orange-600 dark:text-orange-400">{displayName}</p>
                          </div>;
            })}
                    </div>
                  </div>}

                {/* Add Additional Enamel - Navigate to Door & Window tab */}
                <Button variant="outline" className="w-full border-dashed border-orange-300 text-orange-700" onClick={() => {
          try {
            const enamelBase = enamelConfigs.reduce((sum, c) => sum + c.area, 0);
            const currentRoomIds = rooms.filter(room => {
              const projectType = room.project_type;
              if (selectedPaintType === "Interior") return projectType === "Interior";
              if (selectedPaintType === "Exterior") return projectType === "Exterior";
              if (selectedPaintType === "Waterproofing") return projectType === "Waterproofing";
              return false;
            }).map(r => r.id);
            localStorage.setItem(`additional_enamel_baseline_${projectId}_${selectedPaintType}`, JSON.stringify({
              enamel: enamelBase,
              roomIds: currentRoomIds
            }));
            localStorage.setItem(`additional_enamel_mode_${projectId}_${selectedPaintType}`, '1');
            // Set the tab to open "doorwindow" tab
            localStorage.setItem(`open_tab_${projectId}`, 'doorwindow');
          } catch {}
          navigate(`/room-measurement/${projectId}`);
        }}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Additional Enamel Area
                </Button>
              </div>}

            {/* No areas message - only show after rooms have loaded */}
            {areaConfigurations.length === 0 && roomsLoaded && <Card className="eca-shadow">
                <CardContent className="p-6 text-center">
                  <p className="text-muted-foreground">
                    No {selectedPaintType.toLowerCase()} areas found. Please add rooms for {selectedPaintType.toLowerCase()} in the Room Measurements section.
                  </p>
                </CardContent>
              </Card>}
            
            {/* Loading state - show while fetching rooms */}
            {areaConfigurations.length === 0 && !roomsLoaded && <Card className="eca-shadow">
                <CardContent className="p-6 text-center">
                  <div className="flex items-center justify-center space-x-2">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <p className="text-muted-foreground">Loading room data...</p>
                  </div>
                </CardContent>
              </Card>}


            {/* Total Cost Summary */}
            {areaConfigurations.some(c => c.perSqFtRate) && <Card className="eca-shadow border-2 border-primary">
                <CardContent className="p-6">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground mb-2">Total Project Cost</p>
                    <p className="text-4xl font-bold text-primary">
                      ₹ {calculateTotalCost().toFixed(2)}
                    </p>
                  </div>
                </CardContent>
              </Card>}
      </div>

      {/* Configuration Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Configure {selectedConfig?.label}
            </DialogTitle>
          </DialogHeader>
          {selectedConfig && <div className="space-y-4">
              {selectedConfig.areaType !== 'Enamel' && <div className="grid grid-cols-2 gap-3">
                  <Button variant={selectedConfig.paintingSystem === "Fresh Painting" ? "default" : "outline"} onClick={() => handleUpdateConfig({
              paintingSystem: "Fresh Painting"
            })} className="h-20 flex flex-col items-center justify-center">
                    <p className="font-medium">Fresh Painting</p>
                    <p className="text-xs opacity-80">Complete system</p>
                  </Button>
                  <Button variant={selectedConfig.paintingSystem === "Repainting" ? "default" : "outline"} onClick={() => handleUpdateConfig({
              paintingSystem: "Repainting"
            })} className="h-20 flex flex-col items-center justify-center">
                    <p className="font-medium">Repainting</p>
                    <p className="text-xs opacity-80">Refresh system</p>
                  </Button>
                </div>}

              {selectedConfig.areaType === 'Enamel' && <>
                  {!selectedConfig.paintingSystem ? (/* Step 1: Fresh Painting / Repainting Selection for Enamel */
            <div className="grid grid-cols-2 gap-3">
                      <Button variant="outline" onClick={() => handleUpdateConfig({
                paintingSystem: "Fresh Painting"
              })} className="h-20 flex flex-col items-center justify-center">
                        <p className="font-medium">Fresh Painting</p>
                        <p className="text-xs opacity-80">Complete system</p>
                      </Button>
                      <Button variant="outline" onClick={() => handleUpdateConfig({
                paintingSystem: "Repainting"
              })} className="h-20 flex flex-col items-center justify-center">
                        <p className="font-medium">Repainting</p>
                        <p className="text-xs opacity-80">Refresh system</p>
                      </Button>
                    </div>) : (/* Step 2: Enamel Configuration after system selection */
            <>
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-muted-foreground">
                          System: <span className="font-medium text-foreground">{selectedConfig.paintingSystem}</span>
                        </p>
                        <Button variant="ghost" size="sm" onClick={() => {
                  setAreaConfigurations(prev => {
                    const updated = prev.map(c => c.id === selectedConfig.id ? {
                      ...c,
                      paintingSystem: '' as "Fresh Painting" | "Repainting"
                    } : c);
                    const savedConfigKey = `paint_configs_${projectId}_${selectedPaintType}`;
                    try {
                      localStorage.setItem(savedConfigKey, JSON.stringify(updated));
                    } catch (e) {
                      console.error('Error saving configs:', e);
                    }
                    return updated;
                  });
                  const updatedConfig = areaConfigurations.find(c => c.id === selectedConfig.id);
                  if (updatedConfig) {
                    setSelectedConfigId(selectedConfig.id);
                  }
                }}>
                          Change System
                        </Button>
                      </div>

                      <div className="bg-muted rounded-lg p-4 space-y-4">
                        <h4 className="font-medium text-sm">Enamel Configuration</h4>

                        {/* Primer Type and Coats */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">Primer</Label>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">​</span>
                              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                        enamelConfig: {
                          primerType: selectedConfig.enamelConfig?.primerType || '',
                          primerCoats: Math.max(0, (selectedConfig.enamelConfig?.primerCoats ?? 0) - 1),
                          enamelType: selectedConfig.enamelConfig?.enamelType || '',
                          enamelCoats: selectedConfig.enamelConfig?.enamelCoats ?? 0
                        }
                      })}>
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-8 text-center font-medium">
                                {selectedConfig.enamelConfig?.primerCoats ?? 0}
                              </span>
                              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                        enamelConfig: {
                          primerType: selectedConfig.enamelConfig?.primerType || '',
                          primerCoats: Math.min(5, (selectedConfig.enamelConfig?.primerCoats ?? 0) + 1),
                          enamelType: selectedConfig.enamelConfig?.enamelType || '',
                          enamelCoats: selectedConfig.enamelConfig?.enamelCoats ?? 0
                        }
                      })}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <Select value={selectedConfig.enamelConfig?.primerType || undefined} onValueChange={value => handleUpdateConfig({
                    enamelConfig: {
                      primerType: value,
                      primerCoats: selectedConfig.enamelConfig?.primerCoats ?? 0,
                      enamelType: selectedConfig.enamelConfig?.enamelType || '',
                      enamelCoats: selectedConfig.enamelConfig?.enamelCoats ?? 0
                    }
                  })}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Select Primer Type" />
                            </SelectTrigger>
                            <SelectContent>
                              {enamelPrimerProducts.length > 0 ? enamelPrimerProducts.map(product => <SelectItem key={product} value={product}>{product}</SelectItem>) : <>
                                  <SelectItem value="AP TruCare Wood Primer">AP TruCare Wood Primer</SelectItem>
                                  <SelectItem value="AP TruCare Red Oxide Metal Primer">AP TruCare Red Oxide Metal Primer</SelectItem>
                                  <SelectItem value="AP TruCare Yellow Metal Primer">AP TruCare Yellow Metal Primer</SelectItem>
                                </>}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Enamel Type and Coats */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">Enamel</Label>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">
                      </span>
                              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                        enamelConfig: {
                          primerType: selectedConfig.enamelConfig?.primerType || '',
                          primerCoats: selectedConfig.enamelConfig?.primerCoats ?? 0,
                          enamelType: selectedConfig.enamelConfig?.enamelType || '',
                          enamelCoats: Math.max(0, (selectedConfig.enamelConfig?.enamelCoats ?? 0) - 1)
                        }
                      })}>
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-8 text-center font-medium">
                                {selectedConfig.enamelConfig?.enamelCoats ?? 0}
                              </span>
                              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                        enamelConfig: {
                          primerType: selectedConfig.enamelConfig?.primerType || '',
                          primerCoats: selectedConfig.enamelConfig?.primerCoats ?? 0,
                          enamelType: selectedConfig.enamelConfig?.enamelType || '',
                          enamelCoats: Math.min(5, (selectedConfig.enamelConfig?.enamelCoats ?? 0) + 1)
                        }
                      })}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <Select value={selectedConfig.enamelConfig?.enamelType || undefined} onValueChange={value => handleUpdateConfig({
                    enamelConfig: {
                      primerType: selectedConfig.enamelConfig?.primerType || '',
                      primerCoats: selectedConfig.enamelConfig?.primerCoats ?? 0,
                      enamelType: value,
                      enamelCoats: selectedConfig.enamelConfig?.enamelCoats ?? 0
                    }
                  })}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Select Enamel Type" />
                            </SelectTrigger>
                            <SelectContent>
                              {apcoliteEnamelProducts.length > 0 ? apcoliteEnamelProducts.map(product => <SelectItem key={product} value={product}>{product}</SelectItem>) : <>
                                  <SelectItem value="AP Apcolite Premium Gloss Enamel">AP Apcolite Premium Gloss Enamel</SelectItem>
                                  <SelectItem value="AP Apcolite Premium Satin Enamel">AP Apcolite Premium Satin Enamel</SelectItem>
                                  <SelectItem value="AP Apcolite Premium Advanced Enamel">AP Apcolite Premium Advanced Enamel</SelectItem>
                                  <SelectItem value="AP Apcolite Rust Shield PU Enamel">AP Apcolite Rust Shield PU Enamel</SelectItem>
                                  <SelectItem value="AP Apcolite Insect Shield Enamel">AP Apcolite Insect Shield Enamel</SelectItem>
                                </>}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </>)}
                </>}

              {selectedConfig.areaType !== 'Enamel' && selectedConfig.paintingSystem === "Fresh Painting" && <div className="bg-muted rounded-lg p-4 space-y-4">
                  <h4 className="font-medium text-sm">Fresh Painting Configuration</h4>
                  
                  {/* Putty Section */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Putty Coats</Label>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                    coatConfiguration: {
                      ...selectedConfig.coatConfiguration,
                      putty: Math.max(0, selectedConfig.coatConfiguration.putty - 1)
                    }
                  })}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-medium">
                          {selectedConfig.coatConfiguration.putty}
                        </span>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                    coatConfiguration: {
                      ...selectedConfig.coatConfiguration,
                      putty: Math.min(5, selectedConfig.coatConfiguration.putty + 1)
                    }
                  })}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <Select value={selectedConfig.selectedMaterials.putty} onValueChange={value => handleUpdateConfig({
                selectedMaterials: {
                  ...selectedConfig.selectedMaterials,
                  putty: value
                }
              })}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select putty type" />
                      </SelectTrigger>
                      <SelectContent>
                          <SelectItem value="AP TruCare Wall Putty">
                              AP TruCare Wall Putty
                          </SelectItem>
                          <SelectItem value="AP SmartCare Waterproof Wall Putty">
                              AP SmartCare Waterproof Wall Putty
                          </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Primer Section */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Primer Coats</Label>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                    coatConfiguration: {
                      ...selectedConfig.coatConfiguration,
                      primer: Math.max(0, selectedConfig.coatConfiguration.primer - 1)
                    }
                  })}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-medium">
                          {selectedConfig.coatConfiguration.primer}
                        </span>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                    coatConfiguration: {
                      ...selectedConfig.coatConfiguration,
                      primer: Math.min(5, selectedConfig.coatConfiguration.primer + 1)
                    }
                  })}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <Select value={selectedConfig.selectedMaterials.primer} onValueChange={value => handleUpdateConfig({
                selectedMaterials: {
                  ...selectedConfig.selectedMaterials,
                  primer: value
                }
              })}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select primer type" />
                      </SelectTrigger>
                      <SelectContent>
                        {coverageData.filter(item => item.category === "Primer").map(item => item.product_name).filter((value, index, self) => self.indexOf(value) === index).sort((a, b) => a.localeCompare(b)).map(primerName => <SelectItem key={primerName} value={primerName}>
                              {primerName}
                            </SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Emulsion Section */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Emulsion Coats</Label>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                    coatConfiguration: {
                      ...selectedConfig.coatConfiguration,
                      emulsion: Math.max(0, selectedConfig.coatConfiguration.emulsion - 1)
                    }
                  })}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-medium">
                          {selectedConfig.coatConfiguration.emulsion}
                        </span>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                    coatConfiguration: {
                      ...selectedConfig.coatConfiguration,
                      emulsion: Math.min(5, selectedConfig.coatConfiguration.emulsion + 1)
                    }
                  })}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <Popover open={emulsionComboOpen} onOpenChange={setEmulsionComboOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" aria-expanded={emulsionComboOpen} className="h-9 w-full justify-between">
                          {selectedConfig.selectedMaterials.emulsion || "Select emulsion type"}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[calc(100vw-2rem)] sm:w-[400px] p-0 pointer-events-auto z-50" align="start" side="top">
                        <Command className="rounded-lg border shadow-md">
                          <CommandList className="max-h-[300px]">
                            <CommandEmpty>No emulsion found.</CommandEmpty>
                            <CommandGroup>
                              {sortProductNames(coverageData.filter(item => {
                          // Map paint type to correct category names in database
                          const category = selectedPaintType === "Interior" ? "Interior Emulsion" : selectedPaintType === "Exterior" ? "Exterior Emulsion" : "Waterproofing";
                          return item.category === category;
                        }).map(item => item.product_name).filter((value, index, self) => self.indexOf(value) === index)).map(emulsionName => <CommandItem key={emulsionName} value={emulsionName} onSelect={currentValue => {
                          handleUpdateConfig({
                            selectedMaterials: {
                              ...selectedConfig.selectedMaterials,
                              emulsion: currentValue === selectedConfig.selectedMaterials.emulsion ? "" : currentValue
                            }
                          });
                          setEmulsionComboOpen(false);
                        }}>
                                    <Check className={cn("mr-2 h-4 w-4", selectedConfig.selectedMaterials.emulsion === emulsionName ? "opacity-100" : "opacity-0")} />
                                    {emulsionName}
                                  </CommandItem>)}
                            </CommandGroup>
                          </CommandList>
                          <CommandInput placeholder="Search emulsion..." className="border-t" />
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>}

              {selectedConfig.areaType !== 'Enamel' && selectedConfig.paintingSystem === "Repainting" && <div className="bg-muted rounded-lg p-4 space-y-4">
                  <h4 className="font-medium text-sm">Repainting Configuration</h4>
                  
                  {/* Primer Section */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Primer Coats</Label>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                    repaintingConfiguration: {
                      ...selectedConfig.repaintingConfiguration,
                      primer: Math.max(0, selectedConfig.repaintingConfiguration.primer - 1)
                    }
                  })}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-medium">
                          {selectedConfig.repaintingConfiguration.primer}
                        </span>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                    repaintingConfiguration: {
                      ...selectedConfig.repaintingConfiguration,
                      primer: Math.min(5, selectedConfig.repaintingConfiguration.primer + 1)
                    }
                  })}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <Select value={selectedConfig.selectedMaterials.primer} onValueChange={value => handleUpdateConfig({
                selectedMaterials: {
                  ...selectedConfig.selectedMaterials,
                  primer: value
                }
              })}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select primer type" />
                      </SelectTrigger>
                      <SelectContent>
                        {coverageData.filter(item => item.category === "Primer").map(item => item.product_name).filter((value, index, self) => self.indexOf(value) === index).sort((a, b) => a.localeCompare(b)).map(primerName => <SelectItem key={primerName} value={primerName}>
                              {primerName}
                            </SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Emulsion Section */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Emulsion Coats</Label>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                    repaintingConfiguration: {
                      ...selectedConfig.repaintingConfiguration,
                      emulsion: Math.max(0, selectedConfig.repaintingConfiguration.emulsion - 1)
                    }
                  })}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-medium">
                          {selectedConfig.repaintingConfiguration.emulsion}
                        </span>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleUpdateConfig({
                    repaintingConfiguration: {
                      ...selectedConfig.repaintingConfiguration,
                      emulsion: Math.min(5, selectedConfig.repaintingConfiguration.emulsion + 1)
                    }
                  })}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <Popover open={emulsionComboOpen} onOpenChange={setEmulsionComboOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" aria-expanded={emulsionComboOpen} className="h-9 w-full justify-between">
                          {selectedConfig.selectedMaterials.emulsion || "Select emulsion type"}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[calc(100vw-2rem)] sm:w-[400px] p-0 pointer-events-auto z-50" align="start" side="top">
                        <Command className="rounded-lg border shadow-md">
                          <CommandList className="max-h-[300px]">
                            <CommandEmpty>No emulsion found.</CommandEmpty>
                            <CommandGroup>
                                {sortProductNames(coverageData.filter(item => {
                          // Map paint type to correct category names in database
                          const category = selectedPaintType === "Interior" ? "Interior Emulsion" : selectedPaintType === "Exterior" ? "Exterior Emulsion" : "Waterproofing";
                          return item.category === category;
                        }).map(item => item.product_name).filter((value, index, self) => self.indexOf(value) === index)).map(emulsionName => <CommandItem key={emulsionName} value={emulsionName} onSelect={currentValue => {
                          handleUpdateConfig({
                            selectedMaterials: {
                              ...selectedConfig.selectedMaterials,
                              emulsion: currentValue === selectedConfig.selectedMaterials.emulsion ? "" : currentValue
                            }
                          });
                          setEmulsionComboOpen(false);
                        }}>
                                    <Check className={cn("mr-2 h-4 w-4", selectedConfig.selectedMaterials.emulsion === emulsionName ? "opacity-100" : "opacity-0")} />
                                    {emulsionName}
                                  </CommandItem>)}
                            </CommandGroup>
                          </CommandList>
                          <CommandInput placeholder="Search emulsion..." className="border-t" />
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>}

              <Button className="w-full" onClick={() => {
                setDialogOpen(false);
                toast.success('Configuration saved');
              }} disabled={selectedConfig.areaType !== 'Enamel' && !selectedConfig.paintingSystem}>
                Save Configuration
              </Button>
            </div>}
        </DialogContent>
      </Dialog>

       {/* Fixed Bottom Button */}
       <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border">
         <Button className="w-full h-12 text-base font-medium" onClick={handleSaveProject} disabled={!areaConfigurations.some(c => c.paintingSystem && c.perSqFtRate) || isCalculating}>
           {isCalculating ? <div className="flex items-center gap-2">
               <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
               <span>Saving...</span>
             </div> : 'Save Project'}
         </Button>
      </div>
    </div>;
}
