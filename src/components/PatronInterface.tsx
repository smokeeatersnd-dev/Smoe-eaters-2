import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Html5Qrcode } from 'html5-qrcode';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { 
  Sparkles, 
  Search, 
  BookOpen, 
  Check, 
  Plus, 
  Minus, 
  Trash2, 
  ChevronRight, 
  AlertTriangle,
  FileText,
  Clock,
  Info,
  HelpCircle,
  Wine,
  RefreshCw,
  Heart,
  ThumbsUp,
  ThumbsDown,
  User,
  MessageSquare,
  Bookmark,
  Star,
  Utensils,
  QrCode,
  Receipt,
  MapPin,
  LogIn,
  LogOut,
  UserPlus,
  ShieldAlert,
  PhoneCall,
  ShoppingCart,
  BellRing
} from 'lucide-react';
import { Recipe, InventorySchema, StockState, RecipeCategory, FoodItem, BrandingConfig, TableAlert, Special } from '../types';

interface PatronOrder {
  id: string;
  recipeId: string;
  recipeName: string;
  price: number;
  timestamp: string;
  status: 'Pending' | 'Preparing' | 'Ready' | 'Served';
  table?: string;
  seat?: string;
}

interface PatronInterfaceProps {
  recipes: Recipe[];
  setRecipes: React.Dispatch<React.SetStateAction<Recipe[]>>;
  stock: StockState;
  inventory: InventorySchema;
  addNotification: (message: string, type: 'info' | 'success' | 'alert' | 'stock') => void;
  isPatronMode: boolean;
  setIsPatronMode: React.Dispatch<React.SetStateAction<boolean>>;
  pricingConfig?: {
    cogsTarget: number;
    markupFactor: number;
    largeBottlePours: number;
  };
  foodMenu: FoodItem[];
  setFoodMenu: React.Dispatch<React.SetStateAction<FoodItem[]>>;
  brandingConfig?: BrandingConfig;
  tableAlerts?: TableAlert[];
  specials?: Special[];
}

interface PatronRating {
  liked: boolean; // true = thumbs up, false = thumbs down
  comment?: string;
  timestamp: string;
}

interface PatronProfile {
  name: string;
  flavorPreference: string;
  savedRecipeIds: string[];
  ratings: Record<string, PatronRating>;
  orders: PatronOrder[];
  tableNumber?: string;
  seatNumber?: string;
}

const DRINK_CATEGORIES = ['All', 'Cocktail', 'Shot', 'Beer', 'Wine', 'Non-Alcoholic', 'Liquor', 'Specialty', 'Patron Custom', 'Other'] as const;

export const PatronInterface: React.FC<PatronInterfaceProps> = ({
  recipes,
  setRecipes,
  stock,
  inventory,
  addNotification,
  isPatronMode,
  setIsPatronMode,
  pricingConfig,
  foodMenu,
  setFoodMenu,
  brandingConfig,
  tableAlerts = [],
  specials = []
}) => {
  // Navigation: 'menu' | 'mix' | 'ai-mixologist' | 'food' | 'profile' | 'scan' | 'bill'
  const [patronSubTab, setPatronSubTab] = useState<'menu' | 'mix' | 'ai-mixologist' | 'food' | 'profile' | 'scan' | 'bill'>('menu');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const getSpecialDiscount = (
    name: string,
    price: number,
    isFood: boolean
  ) => {
    const match = specials.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (!match) {
      return { discountedPrice: price, hasSpecial: false, discountAmount: 0 };
    }
    let discount = 0;
    if (match.discountType === 'percentage') {
      discount = price * (match.discountValue / 100);
    } else {
      discount = match.discountValue;
    }
    
    // Cap rules:
    // If food item, max is 50% of the price.
    // Otherwise, price cannot reflect more than $1.00 off.
    if (isFood) {
      discount = Math.min(discount, price * 0.5);
    } else {
      discount = Math.min(discount, 1.00);
    }
    
    const discountedPrice = Math.max(0, price - discount);
    return {
      discountedPrice,
      hasSpecial: true,
      discountAmount: discount,
      specialPeriod: match.period
    };
  };

  // Auto-join if URL contains parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tableParam = params.get('table');
    const seatParam = params.get('seat');
    if (tableParam || seatParam) {
      updateProfile({
        ...(tableParam ? { tableNumber: tableParam } : {}),
        ...(seatParam ? { seatNumber: seatParam } : {})
      });
      addNotification(`Joined via Link: Table ${(tableParam || 't1').toUpperCase()} | Seat ${seatParam || '1'}`, 'success');
    }
  }, []);

  // Setup HTML5 scanner element listener & instantiation
  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;
    
    if (patronSubTab === 'scan' && isScanning) {
      const timer = setTimeout(() => {
        try {
          html5QrCode = new Html5Qrcode("qr-reader");
          html5QrCode.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: { width: 250, height: 250 }
            },
            (decodedText) => {
              try {
                let tab = 't1';
                let seat = '1';
                if (decodedText.includes('table=') || decodedText.includes('seat=')) {
                  const urlParams = new URLSearchParams(decodedText.substring(decodedText.indexOf('?')));
                  tab = urlParams.get('table') || 't1';
                  seat = urlParams.get('seat') || '1';
                } else {
                  const match = decodedText.match(/t(able)?[-:\s]*([a-zA-Z\d]+)[-,\s]*s(eat)?[-:\s]*(\d+)/i);
                  if (match) {
                    tab = match[2];
                    seat = match[4];
                  } else {
                    const matchSimple = decodedText.match(/([a-zA-Z\d]+)[-,\s]+(\d+)/);
                    if (matchSimple) {
                      tab = matchSimple[1];
                      seat = matchSimple[2];
                    } else {
                      tab = decodedText.trim().replace(/\s+/, '-');
                    }
                  }
                }
                
                updateProfile({ tableNumber: tab, seatNumber: seat });
                addNotification(`Successfully checked in to Table ${tab.toUpperCase()} | Seat ${seat}!`, 'success');
                setIsScanning(false);
                setPatronSubTab('menu');
              } catch (e) {
                console.error("Failed to parse scanned string:", decodedText);
                setScanError("Parsed string error: " + String(e));
              }
            },
            () => {
              // silent scanning matches
            }
          ).catch((err) => {
            console.error("Camera access failed:", err);
            setScanError("Camera access failed. Ensure permissions are allowed or use simulated checkins below!");
          });
        } catch (err) {
          console.error("Scanner init failed:", err);
          setScanError("Scanner system component failure: " + String(err));
        }
      }, 350);

      return () => {
        clearTimeout(timer);
        if (html5QrCode) {
          if (html5QrCode.isScanning) {
            html5QrCode.stop().then(() => {
              html5QrCode?.clear();
            }).catch(e => console.error("Error stopping qr: ", e));
          }
        }
      };
    }
  }, [patronSubTab, isScanning]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [onlySaved, setOnlySaved] = useState(false);
  const [focusedRecipeId, setFocusedRecipeId] = useState<string | null>(null);

  // Guest live feedback comment draft state keying off of recipe draft feedback dialog
  const [activeReviewingRecipeId, setActiveReviewingRecipeId] = useState<string | null>(null);
  const [draftLiked, setDraftLiked] = useState<boolean>(true);
  const [draftComment, setDraftComment] = useState<string>('');

  // Track ordering modals and popups
  const [orderingRecipe, setOrderingRecipe] = useState<Recipe | null>(null);
  const [selectedMixerForRecipe, setSelectedMixerForRecipe] = useState<Record<string, string>>({});
  const [activeSubstitutions, setActiveSubstitutions] = useState<Record<string, string>>({});
  const [orderedSuccessDrink, setOrderedSuccessDrink] = useState<string | null>(null);
  const [viewingQrTicketOrder, setViewingQrTicketOrder] = useState<{
    id: string;
    type: 'cocktail' | 'food';
    itemName: string;
    table: string;
    seat: string;
    guestName: string;
    notes?: string;
    price?: number;
  } | null>(null);

  // Load customer profile from local storage with auto-save
  const [profile, setProfile] = useState<PatronProfile>(() => {
    const saved = localStorage.getItem('se_patron_profile_v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            name: parsed.name || 'Anonymous Guest',
            flavorPreference: parsed.flavorPreference || 'All Flavors',
            savedRecipeIds: parsed.savedRecipeIds || [],
            ratings: parsed.ratings || {},
            orders: parsed.orders || [],
            tableNumber: parsed.tableNumber || 't1',
            seatNumber: parsed.seatNumber || '1'
          };
        }
      } catch (e) {
        console.error("Failed to parse guest profile", e);
      }
    }
    return {
      name: 'Lounge Guest',
      flavorPreference: 'All Flavors',
      savedRecipeIds: [],
      ratings: {},
      orders: [],
      tableNumber: 't1',
      seatNumber: '1'
    };
  });

  // --- New Loyalty Authentication States ---
  const [activePatronUser, setActivePatronUser] = useState<{
    id: string; // Google UID or passcode loyalty username
    name: string;
    authProvider: 'google' | 'pin';
    email?: string | null;
  } | null>(() => {
    const saved = localStorage.getItem('se_patron_auth_v1');
    return saved ? JSON.parse(saved) : null;
  });

  const [isSyncProcessing, setIsSyncProcessing] = useState(false);
  const [registerMode, setRegisterMode] = useState<boolean>(false);
  const [loginUsername, setLoginUsername] = useState<string>('');
  const [loginPin, setLoginPin] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);

  // --- Geolocation Proximity Engine ---
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [nearestEstablishment, setNearestEstablishment] = useState<{
    name: string;
    distanceMetres: number;
    address: string;
    hasApp: boolean;
  } | null>(null);
  const [showLocationPopup, setShowLocationPopup] = useState(false);
  const [locationPermissionState, setLocationPermissionState] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [simulatedLocationId, setSimulatedLocationId] = useState<string | null>(null);

  const SMOKE_EATERS_ESTABLISHMENTS = useMemo(() => [
    {
      id: 'bismarck',
      name: "Smoke Eaters Bismarck Lounge",
      lat: 46.8133,
      lng: -100.7837,
      address: "105 Main Ave, Bismarck, ND 58501",
      hasApp: true
    },
    {
      id: 'west_fargo',
      name: "Smoke Eaters West Fargo Hub",
      lat: 46.8738,
      lng: -96.9038,
      address: "4150 4th Ave S, Fargo, ND 58103",
      hasApp: true
    },
    {
      id: 'fargo_hq',
      name: "Smoke Eaters Fargo HQ",
      lat: 46.8772,
      lng: -96.7898,
      address: "210 Broadway N, Fargo, ND 58102",
      hasApp: true
    }
  ], []);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // Earth radius in metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // distance in metres
  };

  const checkProximity = (lat: number, lng: number, forceShowAlert: boolean = false) => {
    let bestDist = Infinity;
    let closestNode = null;

    SMOKE_EATERS_ESTABLISHMENTS.forEach((est) => {
      const dist = calculateDistance(lat, lng, est.lat, est.lng);
      if (dist < bestDist) {
        bestDist = dist;
        closestNode = est;
      }
    });

    if (closestNode) {
      const nearest = {
        name: (closestNode as any).name,
        distanceMetres: bestDist,
        address: (closestNode as any).address,
        hasApp: (closestNode as any).hasApp
      };
      setNearestEstablishment(nearest);
      
      // If within 1500 meters or forced via simulator click, show proximity welcome modal!
      if (bestDist <= 1500 || forceShowAlert) {
        setShowLocationPopup(true);
        addNotification(`📍 Welcome to ${(closestNode as any).name}! Local menus and dynamic ordering sync initialized.`, 'success');
      }
    }
  };

  // Run automatically on component mount to retrieve high-accuracy real coords
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setUserCoords({ lat, lng });
          setLocationPermissionState('granted');
          checkProximity(lat, lng, false);
        },
        (error) => {
          console.warn("[GEOLOCATION] Failed to resolve coordinates automatically:", error.message);
          setLocationPermissionState('denied');
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    } else {
      console.warn("Geolocation API is unsupported by browser window.");
    }
  }, []);

  // Handle simulation of coordinates to test geolocation welcome popups inside sandbox
  const handleSimulateLocation = (locId: string | null) => {
    setSimulatedLocationId(locId);
    if (!locId) {
      setUserCoords(null);
      setNearestEstablishment(null);
      addNotification("Removed GPS coordinate simulation.", "info");
      return;
    }
    const matched = SMOKE_EATERS_ESTABLISHMENTS.find(e => e.id === locId);
    if (matched) {
      setUserCoords({ lat: matched.lat, lng: matched.lng });
      setLocationPermissionState('granted');
      checkProximity(matched.lat, matched.lng, true);
    }
  };

  const handleCloudLogin = async (id: string, provider: 'google' | 'pin', customName?: string, customEmail?: string) => {
    setIsSyncProcessing(true);
    setAuthError(null);
    try {
      const dbIdClean = id.trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '');
      if (provider === 'pin' && !dbIdClean) {
        throw new Error("Invalid username characters. Use alphanumeric letters only.");
      }
      
      // Use clean index path for PIN accounts or Google Auth UID
      const docPathId = provider === 'google' ? id : `pin-${dbIdClean}`;
      const docRef = doc(db, 'patrons', docPathId);
      const snap = await getDoc(docRef);

      let loadedProfile: PatronProfile;
      if (snap.exists()) {
        const cloudData = snap.data();
        
        // If PIN login, check if PIN matches!
        if (provider === 'pin' && cloudData.pin && cloudData.pin !== loginPin) {
          throw new Error("Incorrect login PIN. Unauthorized access to codename denied.");
        }

        loadedProfile = {
          name: cloudData.name || customName || 'Lounge Member',
          flavorPreference: cloudData.flavorPreference || 'All Flavors',
          savedRecipeIds: cloudData.savedRecipeIds || [],
          ratings: cloudData.ratings || {},
          orders: cloudData.orders || [],
          tableNumber: cloudData.tableNumber || profile.tableNumber || 't1',
          seatNumber: cloudData.seatNumber || profile.seatNumber || '1'
        };
        addNotification(`Loyalty profile synchronized! Loaded ${loadedProfile.savedRecipeIds.length} saved recipes.`, 'success');
      } else {
        // If registering a Pin profile or new Google authenticated profile
        if (provider === 'pin' && registerMode === false) {
          throw new Error("Loyalty username not found. Register your codename first!");
        }

        loadedProfile = {
          name: customName || profile.name || 'Lounge Guest',
          flavorPreference: profile.flavorPreference || 'All Flavors',
          savedRecipeIds: profile.savedRecipeIds || [],
          ratings: profile.ratings || {},
          orders: profile.orders || [],
          tableNumber: profile.tableNumber || 't1',
          seatNumber: profile.seatNumber || '1'
        };

        // Write initial document to Firestore
        await setDoc(docRef, {
          id: docPathId,
          name: loadedProfile.name,
          flavorPreference: loadedProfile.flavorPreference,
          savedRecipeIds: loadedProfile.savedRecipeIds,
          ratings: loadedProfile.ratings,
          orders: loadedProfile.orders,
          pin: provider === 'pin' ? loginPin : '',
          authProvider: provider,
          tableNumber: loadedProfile.tableNumber,
          seatNumber: loadedProfile.seatNumber,
          updatedAt: new Date().toISOString()
        });
        addNotification(`Success! Brand new lounge account "${loadedProfile.name}" initialized in the cloud.`, 'success');
      }

      const authSession = { id: docPathId, name: loadedProfile.name, authProvider: provider, email: customEmail };
      localStorage.setItem('se_patron_auth_v1', JSON.stringify(authSession));
      setActivePatronUser(authSession);

      setProfile(loadedProfile);
      localStorage.setItem('se_patron_profile_v1', JSON.stringify(loadedProfile));
      
      // Reset inputs
      setLoginUsername('');
      setLoginPin('');
      setRegisterMode(false);
    } catch (e: any) {
      console.error(e);
      setAuthError(e.message || "Cloud authentication rejected.");
      addNotification(e.message || "Failed to log in to member account.", "alert");
    } finally {
      setIsSyncProcessing(false);
    }
  };

  const handleSignOutPatron = () => {
    localStorage.removeItem('se_patron_auth_v1');
    setActivePatronUser(null);
    addNotification("Signed out from loyalty cloud account. Resetting to standard sandbox storage.", "info");
  };

  const updateProfile = (updated: Partial<PatronProfile>) => {
    setProfile(prev => {
      const next = { ...prev, ...updated };
      localStorage.setItem('se_patron_profile_v1', JSON.stringify(next));

      // Auto-sync payload changes to active cloud account if authenticated
      if (activePatronUser) {
        const docRef = doc(db, 'patrons', activePatronUser.id);
        setDoc(docRef, {
          id: activePatronUser.id,
          name: next.name,
          flavorPreference: next.flavorPreference,
          savedRecipeIds: next.savedRecipeIds,
          ratings: next.ratings,
          orders: next.orders,
          tableNumber: next.tableNumber,
          seatNumber: next.seatNumber,
          updatedAt: new Date().toISOString()
        }, { merge: true }).catch(err => {
          console.error("Auto sync update failure: ", err);
        });
      }

      return next;
    });
  };

  const handleToggleSaveRecipe = (recipeId: string) => {
    const isSaved = profile.savedRecipeIds.includes(recipeId);
    let nextSaved: string[];
    if (isSaved) {
      nextSaved = profile.savedRecipeIds.filter(id => id !== recipeId);
      addNotification(`Removed recipe from saved bookmarks`, 'info');
    } else {
      nextSaved = [...profile.savedRecipeIds, recipeId];
      const rec = recipes.find(r => r.id === recipeId);
      addNotification(`Saved "${rec?.name || 'drink'}" to your profile!`, 'success');
    }
    updateProfile({ savedRecipeIds: nextSaved });

    // Multi-user dynamic counting inside main BOH recipe items database
    setRecipes(prev => prev.map(r => {
      if (r.id === recipeId) {
        const currentCount = r.favoritesCount || 0;
        return {
          ...r,
          favoritesCount: Math.max(0, isSaved ? currentCount - 1 : currentCount + 1)
        };
      }
      return r;
    }));
  };

  const handleRateRecipe = (recipeId: string, liked: boolean, commentText: string = '') => {
    const rec = recipes.find(r => r.id === recipeId);
    const timestampStr = new Date().toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const nextRatings = {
      ...profile.ratings,
      [recipeId]: {
        liked,
        comment: commentText.trim() || undefined,
        timestamp: timestampStr
      }
    };
    
    updateProfile({ ratings: nextRatings });

    // Save and push this active customer review to backend/staff portal automatic reviews timeline log
    setRecipes(prev => prev.map(r => {
      if (r.id === recipeId) {
        const existingReviews = r.reviews || [];
        // Prevent duplicate client review records by matching guest userName
        const otherReviews = existingReviews.filter(rev => rev.userName !== profile.name);
        return {
          ...r,
          reviews: [
            ...otherReviews,
            {
              userName: profile.name,
              liked,
              comment: commentText.trim() || undefined,
              timestamp: timestampStr
            }
          ]
        };
      }
      return r;
    }));
    
    // Broadcast live dashboard notifications to bar staff
    let alertMsg = `Patron "${profile.name}" rated "${rec?.name || 'Drink'}" as ${liked ? 'Thumbs Up' : 'Thumbs Down'}`;
    if (commentText.trim()) {
      alertMsg += `: "${commentText.trim()}"`;
    }
    addNotification(alertMsg, liked ? 'success' : 'alert');
  };

  const handleRemoveRating = (recipeId: string) => {
    const nextRatings = { ...profile.ratings };
    delete nextRatings[recipeId];
    updateProfile({ ratings: nextRatings });

    // Clean review from main backend items db directly
    setRecipes(prev => prev.map(r => {
      if (r.id === recipeId) {
        const existingReviews = r.reviews || [];
        return {
          ...r,
          reviews: existingReviews.filter(rev => rev.userName !== profile.name)
        };
      }
      return r;
    }));

    addNotification(`Removed rating feedback`, 'info');
  };

  const handleProfileDirectRating = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileFeedbackDrinkId) {
      alert("Please select a drink to review.");
      return;
    }
    
    // Call existing handleRateRecipe with constructed comments
    const drinkObj = recipes.find(r => r.id === profileFeedbackDrinkId);
    const resolvedName = drinkObj ? drinkObj.name : "Unknown Drink";
    
    const starsString = "★".repeat(profileFeedbackRating) + "☆".repeat(5 - profileFeedbackRating);
    const tagsString = profileFeedbackTags.length > 0 ? `[${profileFeedbackTags.join(', ')}] ` : "";
    const finalComment = `${starsString} ${tagsString}${profileFeedbackComment.trim()}`.trim();
    
    // Call standard rate recipe method
    handleRateRecipe(profileFeedbackDrinkId, profileFeedbackLiked, finalComment);
    
    // Trigger animations
    setProfileFeedbackSuccess(`Thanks! Registered review for "${resolvedName}"!`);
    
    // Reset inputs
    setProfileFeedbackComment('');
    setProfileFeedbackTags([]);
    setProfileFeedbackRating(5);
    
    // Clear success banner after 5 seconds
    setTimeout(() => {
      setProfileFeedbackSuccess(null);
    }, 5000);
  };

  const FOOD_MENU = foodMenu;

  interface PlacedFoodOrder {
    id: string;
    items: { name: string; quantity: number; price: number }[];
    notes?: string;
    subtotal: number;
    tax: number;
    gratuity: number;
    total: number;
    timestamp: string;
    status: 'Received' | 'In the Smoker' | 'Plating' | 'Served';
    table?: string;
    seat?: string;
  }

  // Food Menu States
  const [foodCart, setFoodCart] = useState<Record<string, number>>({});
  const [selectedFoodCategory, setSelectedFoodCategory] = useState<string>('All');
  const [foodOrderNotes, setFoodOrderNotes] = useState<string>('');
  const [foodOrders, setFoodOrders] = useState<PlacedFoodOrder[]>(() => {
    try {
      const stored = localStorage.getItem(`se_food_orders_${profile.name}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const updateFoodOrdersState = (newOrders: PlacedFoodOrder[]) => {
    setFoodOrders(newOrders);
    try {
      localStorage.setItem(`se_food_orders_${profile.name}`, JSON.stringify(newOrders));
    } catch (e) {
      console.error("Local storage write failed", e);
    }
  };

  const handleUpdateCartQuantity = (foodId: string, delta: number) => {
    setFoodCart(prev => {
      const current = prev[foodId] ?? 0;
      const next = current + delta;
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[foodId];
        return copy;
      }
      return { ...prev, [foodId]: next };
    });
  };

  const handleClearCart = () => {
    setFoodCart({});
  };

  const handlePlaceFoodOrder = () => {
    const itemsToOrder = Object.entries(foodCart)
      .map(([id, qty]) => {
        const match = FOOD_MENU.find(f => f.id === id);
        if (!match) return null;
        const finalPrice = getSpecialDiscount(match.name, match.price, true).discountedPrice;
        return { name: match.name, quantity: qty, price: finalPrice };
      })
      .filter((x): x is { name: string; quantity: number; price: number } => x !== null);

    if (itemsToOrder.length === 0) {
      addNotification("Your food cart is empty!", 'alert');
      return;
    }

    const subtotal = itemsToOrder.reduce((acc, curr) => acc + curr.price * curr.quantity, 0);
    const tax = subtotal * 0.085; // 8.5% state tax
    const gratuity = 0; // Gratuity removed as requested
    const total = subtotal + tax + gratuity;

    const newOrder: PlacedFoodOrder = {
      id: `food-ord-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      items: itemsToOrder,
      notes: foodOrderNotes.trim() || undefined,
      subtotal,
      tax,
      gratuity,
      total,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'Received',
      table: profile.tableNumber || 't1',
      seat: profile.seatNumber || '1'
    };

    const nextOrders = [newOrder, ...foodOrders];
    updateFoodOrdersState(nextOrders);

    // Build standard detail text description for push log notification and write table alert to Firestore
    const detailString = itemsToOrder.map(item => `${item.name} x${item.quantity}`).join(', ');
    
    const alertId = `ord-alert-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    setDoc(doc(db, 'table_alerts', alertId), {
      id: alertId,
      table: profile.tableNumber || 't1',
      seat: profile.seatNumber || '1',
      type: 'order_submitted',
      status: 'active',
      createdAt: new Date().toISOString(),
      items: itemsToOrder,
      total,
      guestName: profile.name
    }).catch(e => console.error("Error creating Firestore table order alert:", e));

    addNotification(`[Table: ${(profile.tableNumber || 't1').toUpperCase()} | Seat: ${profile.seatNumber || '1'}] Kitchen Ticket: Guest "${profile.name}" ordered [ ${detailString} ]! Total: $${total.toFixed(2)}`, 'success');

    // Display localized confirmation
    addNotification("Staff kitchen dispatch triggered! Sizzling started...", 'success');

    // Show order ticket QR Code
    setViewingQrTicketOrder({
      id: newOrder.id,
      type: 'food',
      itemName: detailString,
      table: newOrder.table,
      seat: newOrder.seat,
      guestName: profile.name,
      notes: newOrder.notes,
      price: newOrder.total
    });

    // Reset states
    setFoodCart({});
    setFoodOrderNotes('');

    // Let the status tick forward dynamically for visual feedback
    setTimeout(() => {
      updateOrderStatus(newOrder.id, 'In the Smoker');
    }, 15000);

    setTimeout(() => {
      updateOrderStatus(newOrder.id, 'Plating');
    }, 45000);

    setTimeout(() => {
      updateOrderStatus(newOrder.id, 'Served');
    }, 75000);
  };

  const updateOrderStatus = (orderId: string, nextStatus: 'Received' | 'In the Smoker' | 'Plating' | 'Served') => {
    setFoodOrders(prev => {
      const idx = prev.findIndex(o => o.id === orderId);
      if (idx === -1) return prev;
      const copy = [...prev];
      copy[idx] = { ...copy[idx], status: nextStatus };
      
      // Persist status updates
      try {
        localStorage.setItem(`se_food_orders_${profile.name}`, JSON.stringify(copy));
      } catch (e) {
        console.error("Local storage write failed", e);
      }
      
      return copy;
    });

    const labelMapping: Record<string, string> = {
      'In the Smoker': 'is smoking in the hickory rack!',
      'Plating': 'is being premium plated!',
      'Served': 'has been served fresh to your table!'
    };

    addNotification(`Your order is now: ${nextStatus === 'Served' ? '💨 ' : '🔥 '}${nextStatus.toUpperCase()}`, 'info');
  };

  // Mixer custom drink form state
  const [mixName, setMixName] = useState('');
  const [mixCategory, setMixCategory] = useState<string>('Cocktail');
  const [mixGlass, setMixGlass] = useState('Highball Glass');
  const [mixGarnish, setMixGarnish] = useState('Lime Wedge');
  const [mixInstructions, setMixInstructions] = useState('');
  const [mixIngredients, setMixIngredients] = useState<{ item: string; amount: string }[]>([
    { item: '', amount: '1.5 oz' }
  ]);
  const [submittedDrink, setSubmittedDrink] = useState<Recipe | null>(null);

  const [isCallingBartender, setIsCallingBartender] = useState(false);

  const handleCallBartender = async () => {
    setIsCallingBartender(true);
    try {
      const alertId = `call-alert-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await setDoc(doc(db, 'table_alerts', alertId), {
        id: alertId,
        table: profile.tableNumber || 't1',
        seat: profile.seatNumber || '1',
        type: 'call_bartender',
        status: 'active',
        createdAt: new Date().toISOString(),
        guestName: profile.name
      });
      addNotification("Bartender has been called! They will arrive shortly.", "success");
    } catch (e) {
      console.error("Error calling bartender:", e);
      addNotification("Failed to call bartender. Please try again.", "alert");
    } finally {
      setIsCallingBartender(false);
    }
  };

  // Lounge Experience Direct Feedbacks
  const [profileFeedbackDrinkId, setProfileFeedbackDrinkId] = useState<string>('');
  const [profileFeedbackLiked, setProfileFeedbackLiked] = useState<boolean>(true);
  const [profileFeedbackComment, setProfileFeedbackComment] = useState<string>('');
  const [profileFeedbackRating, setProfileFeedbackRating] = useState<number>(5);
  const [profileFeedbackTags, setProfileFeedbackTags] = useState<string[]>([]);
  const [profileFeedbackSuccess, setProfileFeedbackSuccess] = useState<string | null>(null);

  // AI Mixologist States & Logic
  const [generatedDrinks, setGeneratedDrinks] = useState<any[]>([]);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiPreference, setAiPreference] = useState('Rugged Firefighter Vibe');
  const [customAiPrompt, setCustomAiPrompt] = useState('');
  const [selectedAiIngredients, setSelectedAiIngredients] = useState<string[]>([]);
  const [aiSuccessMessage, setAiSuccessMessage] = useState<string | null>(null);

  const handleGenerateAiCocktails = async () => {
    setIsAiGenerating(true);
    setAiSuccessMessage(null);
    try {
      // Pick checked ingredients, or fall back to all physical in-stock items
      const targetIngredients = selectedAiIngredients.length > 0 
        ? selectedAiIngredients 
        : inStockIngredients.map(item => item.n);

      if (targetIngredients.length === 0) {
        addNotification("We don't have any in-stock ingredients to match!", 'alert');
        setIsAiGenerating(false);
        return;
      }

      // Combine ingredients list and selected vibe into prompt guidelines
      const inventoryString = targetIngredients.join(', ');
      const combinedInStockInput = `${inventoryString}. Guest requested the vibe: "${aiPreference}" ${customAiPrompt ? `with special request: "${customAiPrompt}"` : ''}`;

      const response = await fetch('/api/ai/mixologist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inStockItems: combinedInStockInput })
      });

      if (!response.ok) {
        throw new Error('Mixology request failed on server');
      }

      const data = await response.json();
      if (Array.isArray(data)) {
        setGeneratedDrinks(data);
        addNotification("AI Mixologist crafted 3 premium cocktails!", 'success');
      } else {
        throw new Error('Invalid response structure');
      }
    } catch (err: any) {
      console.error(err);
      addNotification("Drafting cocktail recipes failed. Try again!", 'alert');
    } finally {
      setIsAiGenerating(false);
    }
  };

  const handlePublishAiDrink = (drink: any) => {
    // Generate full Recipe object
    const newRecipe: Recipe = {
      id: `ai-mix-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: drink.name,
      category: 'Specialty',
      ingredients: drink.ingredients,
      instructions: drink.instructions,
      insight: drink.insight || 'Custom recommendations prepared by AI Mixologist.',
      glassware: 'Rocks Glass',
      garnish: 'Lime Wedge',
      favoritesCount: 1,
      reviews: []
    };

    // Auto cost and price
    const cost = estimatePourCost(newRecipe.ingredients);
    newRecipe.cost = cost;
    newRecipe.sellingPrice = calculatePriceWithMargin(newRecipe);

    // Add to active recipes state
    setRecipes(prev => [newRecipe, ...prev]);

    // Save/Bookmark for Patron profile
    const nextSaved = [...profile.savedRecipeIds, newRecipe.id];
    updateProfile({ savedRecipeIds: nextSaved });

    // Push live staff dashboard notification
    addNotification(`Patron "${profile.name}" ordered AI Mixologist drink "${newRecipe.name}"!`, 'success');
    setAiSuccessMessage(`"${drink.name}" is successfully published! You can order it now.`);
  };

  const handleOrderAiDrink = (drink: any) => {
    // Generate full Recipe object
    const newRecipe: Recipe = {
      id: `ai-mix-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: drink.name,
      category: 'Specialty',
      ingredients: drink.ingredients,
      instructions: drink.instructions,
      insight: drink.insight || 'Custom recommendations prepared by AI Mixologist.',
      glassware: 'Rocks Glass',
      garnish: 'Lime Wedge',
      favoritesCount: 1,
      reviews: []
    };

    // Auto cost and price
    const cost = estimatePourCost(newRecipe.ingredients);
    newRecipe.cost = cost;
    newRecipe.sellingPrice = calculatePriceWithMargin(newRecipe);

    setOrderingRecipe(newRecipe);
  };

  // Flat list of all inventory items
  const flatInventory = useMemo(() => {
    return Object.values(inventory).flat();
  }, [inventory]);

  // List of items currently in stock in physical bar inventory for the custom drink drop-down
  const inStockIngredients = useMemo(() => {
    return flatInventory
      .filter(item => (stock[item.n] ?? 0) > 0)
      .sort((a, b) => a.n.localeCompare(b.n));
  }, [flatInventory, stock]);

  // Ingredient stock helper
  const getIngredientStockInfo = (ingredientName: string) => {
    const queryName = ingredientName.toLowerCase().trim();
    
    // Look for exact/substring match in actual inventory
    const match = flatInventory.find(item => {
      const itemLower = item.n.toLowerCase();
      return itemLower === queryName || 
             itemLower.includes(queryName) || 
             queryName.includes(itemLower);
    });

    if (!match) {
      // Common extra ingredients not tracked in the main distributor list (e.g. Ice, soda gun water, garnish)
      // We assume they're available
      return {
        name: ingredientName,
        foundInInventory: false,
        inStock: true,
        level: null
      };
    }

    const currentStockLevel = stock[match.n] ?? 0;
    return {
      name: match.n,
      foundInInventory: true,
      inStock: currentStockLevel > 0,
      level: currentStockLevel
    };
  };

  // Check if a whole recipe has all ingredients available
  const getRecipeAvailability = (recipe: Recipe) => {
    const ingredientDetails = (recipe.ingredients || []).map(ing => ({
      rawName: ing.item,
      amount: ing.amount,
      info: getIngredientStockInfo(ing.item)
    }));

    const missingIngredients = ingredientDetails
      .filter(ing => !ing.info.inStock)
      .map(ing => ing.info.name);

    return {
      allAvailable: missingIngredients.length === 0,
      ingredientDetails,
      missingIngredients
    };
  };

  // Find an in-stock substitution for a missing ingredient
  const getSubstituteForIngredient = (ingName: string): string | null => {
    const clean = ingName.toLowerCase();
    
    // Define ingredient keyword families
    const families = [
      {
        keywords: ['bourbon', 'whiskey', 'whisky', 'rye', 'scotch', 'irish', 'jack', 'jameson', 'makers', 'woodford', 'bulleit', 'jim beam', 'whisky'],
        searchTerms: ['bourbon', 'whiskey', 'whisky', 'rye', 'scotch', 'jameson']
      },
      {
        keywords: ['vodka', 'tito', 'goose', 'absolut', 'smirnoff'],
        searchTerms: ['vodka']
      },
      {
        keywords: ['tequila', 'patron', 'don julio', 'casamigos', 'cuervo', 'espolon', 'mezcal'],
        searchTerms: ['tequila', 'mezcal']
      },
      {
        keywords: ['rum', 'bacardi', 'captain', 'malibu'],
        searchTerms: ['rum']
      },
      {
        keywords: ['gin', 'tanqueray', 'bombay', 'hendrick', 'beefeater'],
        searchTerms: ['gin']
      },
      {
        keywords: ['triple sec', 'cointreau', 'curacao', 'marnier', 'orange liqueur'],
        searchTerms: ['triple sec', 'cointreau', 'curacao']
      },
      {
        keywords: ['vermouth', 'lillet', 'rosso'],
        searchTerms: ['vermouth']
      },
      {
        keywords: ['syrup', 'sugar', 'honey', 'agave', 'maple'],
        searchTerms: ['syrup', 'honey', 'agave']
      },
      {
        keywords: ['soda', 'coke', 'cola', 'sprite', 'ginger ale', 'ginger beer'],
        searchTerms: ['soda', 'coke', 'cola', 'ginger beer', 'ginger ale']
      }
    ];

    // Check if the missing ingredient belongs to any family
    const matchedFamily = families.find(f => 
      f.keywords.some(kw => clean.includes(kw))
    );

    if (matchedFamily) {
      // Find an in-stock item in flatInventory that matches the family searchTerms and has positive stock
      const substitute = flatInventory.find(item => {
        const itemStock = stock[item.n] ?? 0;
        if (itemStock <= 0) return false;
        
        const itemNameLower = item.n.toLowerCase();
        // Ensure we don't return the exact same item which is known to be missing
        if (itemNameLower === clean || clean.includes(itemNameLower)) return false;

        return matchedFamily.searchTerms.some(st => itemNameLower.includes(st));
      });

      if (substitute) {
        return substitute.n;
      }
    }

    return null;
  };

  // Check which ingredients can be substituted
  const getRecipeSubstitutions = (recipe: Recipe) => {
    const availability = getRecipeAvailability(recipe);
    const substitutions: Record<string, string> = {};
    let canFullySubstitute = true;

    availability.missingIngredients.forEach(missingIng => {
      const sub = getSubstituteForIngredient(missingIng);
      if (sub) {
        substitutions[missingIng] = sub;
      } else {
        canFullySubstitute = false;
      }
    });

    return {
      substitutions,
      hasSubstitutions: Object.keys(substitutions).length > 0,
      canFullySubstitute,
      missingCount: availability.missingIngredients.length
    };
  };

  // Find alternative recipes that are in-stock
  const getRecipeAlternatives = (recipe: Recipe) => {
    return recipes.filter(r => r.id !== recipe.id && r.category === recipe.category && getRecipeAvailability(r).allAvailable).slice(0, 2);
  };

  // Find alternative food items that are in-stock
  const getFoodAlternatives = (item: FoodItem) => {
    return foodMenu.filter(f => f.id !== item.id && f.category === item.category && f.isAvailable && (!f.associatedStockItem || (stock[f.associatedStockItem] ?? 0) > 0)).slice(0, 2);
  };

  // Ounce size parser for cost estimations
  const parseOzFromSize = (sz: string): number => {
    if (!sz) return 0;
    const s = sz.toLowerCase().replace(/\s/g, '');
    const ozMatch = s.match(/(\d+\.?\d*)oz/);
    if (ozMatch) return parseFloat(ozMatch[1]);
    const mlMatch = s.match(/(\d+\.?\d*)ml/);
    if (mlMatch) return parseFloat(mlMatch[1]) * 0.033814;
    const lMatch = s.match(/(\d+\.?\d*)l/);
    if (lMatch && !s.includes('ml')) return parseFloat(lMatch[1]) * 33.814;
    return 0;
  };

  // Calculate pour cost for any recipe
  const estimatePourCost = (ingredientsList: { item: string; amount: string }[]) => {
    let totalCost = 0;
    ingredientsList.forEach(ing => {
      if (!ing.item) return;
      const match = flatInventory.find(item => item.n.toLowerCase() === ing.item.toLowerCase());
      if (match && match.c) {
        const amountStr = ing.amount.replace(/[^0-9.]/g, '');
        const amount = parseFloat(amountStr) || 1.0;
        const totalVolume = parseOzFromSize(match.sz || '');
        
        if (totalVolume > 0) {
          totalCost += (match.c / totalVolume) * amount;
        } else {
          totalCost += match.c * 0.05; // Fallback estimate
        }
      }
    });
    return totalCost > 0 ? Math.round(totalCost * 100) / 100 : 1.25;
  };

  // Get recipe cost checks recipe properties or falls back to ingredient calculation
  const getRecipeCost = (recipe: Recipe) => {
    if (recipe.cost !== undefined && recipe.cost > 0) return recipe.cost;
    return estimatePourCost(recipe.ingredients);
  };

  // Dynamic pricing calculation based on our configured profit targets / margin
  const calculatePriceWithMargin = (recipe: Recipe) => {
    let basePrice = 0;
    if (recipe.sellingPrice !== undefined && recipe.sellingPrice > 0) {
      basePrice = recipe.sellingPrice;
    } else {
      const cost = getRecipeCost(recipe);
      if (cost === 0) return 0;
      const cogs = pricingConfig?.cogsTarget || 0.25;
      const markup = pricingConfig?.markupFactor || 1.09;
      const calculatedPrice = (cost / cogs) * markup;
      basePrice = Math.max(5.50, Math.round(calculatedPrice * 2) / 2 - 0.05);
    }
    
    const spec = getSpecialDiscount(recipe.name, basePrice, false);
    return spec.discountedPrice;
  };

  // Extract dynamic mixers list from back-of-house inventory
  const mixers = useMemo(() => {
    let list = [];
    if (inventory) {
      list = Object.values(inventory)
        .flat()
        .filter(item => !!item.isMixer)
        .map(item => ({ n: item.n }));
    }
    if (list.length === 0) {
      // Fallback premium list if none have been tagged as mixers yet
      return [
        { n: 'Coca-Cola' },
        { n: 'Tonic Water' },
        { n: 'Club Soda' },
        { n: 'Ginger Ale' },
        { n: 'Cranberry Juice' },
        { n: 'Orange Juice' },
        { n: 'Pineapple Juice' },
        { n: 'Lemonade' },
        { n: 'Sweet & Sour' },
        { n: 'Fever Tree Bloody Mary' },
        { n: 'Fever Tree Ginger Beer' },
        { n: 'Fever Tree Margarita Mix' },
      ];
    }
    return list;
  }, [inventory]);

  // Filter recipes for display
  const filteredRecipes = useMemo(() => {
    return recipes.filter(r => {
      // 1. Search Query
      const matchSearch = r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          r.ingredients.some(i => i.item.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          (r.category || '').toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchSearch) return false;

      // 2. Category Pill
      if (selectedCategory !== 'All') {
        const isSelected = (r.category || 'Cocktail').toLowerCase() === selectedCategory.toLowerCase();
        if (!isSelected) return false;
      }

      // 3. In Stock Only Toggle
      if (onlyInStock) {
        const availability = getRecipeAvailability(r);
        if (!availability.allAvailable) return false;
      }

      // 4. Saved Only Toggle
      if (onlySaved) {
        if (!profile.savedRecipeIds.includes(r.id)) return false;
      }

      return true;
    });
  }, [recipes, searchQuery, selectedCategory, onlyInStock, onlySaved, stock, flatInventory, profile.savedRecipeIds]);

  // Mix wizard operations
  const handleAddMixIngredient = () => {
    setMixIngredients(prev => [...prev, { item: '', amount: '1.0 oz' }]);
  };

  const handleRemoveMixIngredient = (index: number) => {
    if (mixIngredients.length <= 1) return;
    setMixIngredients(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateMixIngredient = (index: number, fields: { item?: string; amount?: string }) => {
    setMixIngredients(prev => prev.map((ing, i) => i === index ? { ...ing, ...fields } : ing));
  };

  // Calculate estimated price for customer drink of choice
  const estimatedCustomCost = useMemo(() => {
    return estimatePourCost(mixIngredients);
  }, [mixIngredients, flatInventory]);

  const estimatedCustomPrice = useMemo(() => {
    // Dynamic price based on markup cogs ratio
    const cogs = pricingConfig?.cogsTarget || 0.25;
    const markup = pricingConfig?.markupFactor || 1.09;
    const calculatedPrice = (estimatedCustomCost / cogs) * markup;
    return Math.max(5.50, Math.round(calculatedPrice * 2) / 2 - 0.05);
  }, [estimatedCustomCost, pricingConfig]);

  // Submit hand blended potion to local recipes db
  const handlePublishCustomRecipe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mixName.trim()) {
      alert("Please give your custom drink a name.");
      return;
    }
    const cleanIngredients = mixIngredients.filter(ing => ing.item !== '');
    if (cleanIngredients.length === 0) {
      alert("Specify at least one ingredient to mix.");
      return;
    }

    const newRecipe: Recipe = {
      id: `custom-patron-${Date.now()}`,
      name: mixName.trim(),
      category: 'Patron Custom',
      ingredients: cleanIngredients,
      instructions: mixInstructions.trim() || 'Serve with ice and stir well.',
      glassware: mixGlass,
      garnish: mixGarnish,
      cost: estimatedCustomCost,
      sellingPrice: estimatedCustomPrice,
      insight: `Designed by lounge guest "${profile.name}" in the interactive shaker.`
    };

    // Save recipe to application
    setRecipes(prev => [newRecipe, ...prev]);

    // Track in guest's saved recipes list
    const nextSaved = [...profile.savedRecipeIds, newRecipe.id];
    updateProfile({ savedRecipeIds: nextSaved });

    // Push live staff dashboard notification
    addNotification(`Patron "${profile.name}" mixed a custom drink: "${newRecipe.name}"!`, 'success');

    // Display confirmation and reset
    setSubmittedDrink(newRecipe);
    setMixName('');
    setMixInstructions('');
    setMixIngredients([{ item: '', amount: '1.5 oz' }]);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-[#f2f2f2] font-sans pb-24 selection:bg-orange-500/30">
      {/* Immersive Dark Mode Aura */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-1/4 -right-1/4 w-[120%] h-[120%] bg-[radial-gradient(circle_at_center,rgba(249,115,22,0.06)_0%,transparent_60%)] blur-[100px]" />
        <div className="absolute -bottom-1/4 -left-1/4 w-[120%] h-[120%] bg-[radial-gradient(circle_at_center,rgba(234,88,12,0.04)_0%,transparent_70%)] blur-[110px]" />
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03]" />
      </div>

      {/* Main Patron Header Nav */}
      <header className="relative z-10 p-5 bg-[#0a0a0a]/80 backdrop-blur-3xl border-b border-white/[0.04] sticky top-0 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-orange-600 to-orange-500 rounded-2xl flex items-center justify-center text-white border border-orange-500/30 shadow-lg shadow-orange-500/10">
            <Sparkles className="w-6 h-6 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black uppercase tracking-widest italic text-white text-shadow-sm">SMOKE EATERS</h1>
              <span className="text-[8px] bg-red-500/10 text-red-400 font-extrabold uppercase tracking-widest border border-red-500/20 px-1.5 py-0.5 rounded">Guest Mode</span>
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-orange-500">Lounge & Interactive Tasting Menu</p>
          </div>
        </div>

        {/* Tab Controls Navigation */}
        <div className="flex flex-wrap items-center gap-1.5 bg-black/40 p-1.5 rounded-2xl border border-white/5 shadow-xl">
          <button
            onClick={() => { setPatronSubTab('menu'); setSubmittedDrink(null); }}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
              patronSubTab === 'menu'
                ? 'bg-orange-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Wine className="w-3.5 h-3.5" />
            Drinks Menu
          </button>
          <button
            onClick={() => { setPatronSubTab('mix'); setSubmittedDrink(null); }}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
              patronSubTab === 'mix'
                ? 'bg-orange-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Interactive Mixer
          </button>
          <button
            onClick={() => { setPatronSubTab('ai-mixologist'); setSubmittedDrink(null); }}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
              patronSubTab === 'ai-mixologist'
                ? 'bg-orange-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
            AI Mixologist
          </button>
          <button
            onClick={() => { setPatronSubTab('food'); setSubmittedDrink(null); }}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
              patronSubTab === 'food'
                ? 'bg-orange-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Utensils className="w-3.5 h-3.5 text-orange-400" />
            {brandingConfig?.foodMenuTitle || `${brandingConfig?.brandName || "Smoke Eaters"} Food Menu`}
          </button>
          <button
            onClick={() => { setPatronSubTab('profile'); setSubmittedDrink(null); }}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
              patronSubTab === 'profile'
                ? 'bg-orange-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            Lounge Profile
          </button>
          <button
            onClick={() => { setPatronSubTab('scan'); setSubmittedDrink(null); }}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
              patronSubTab === 'scan'
                ? 'bg-orange-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <QrCode className="w-3.5 h-3.5 text-blue-400" />
            Scan QR Setup
          </button>
          <button
            onClick={() => { setPatronSubTab('bill'); setSubmittedDrink(null); }}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
              patronSubTab === 'bill'
                ? 'bg-orange-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Receipt className="w-3.5 h-3.5 text-green-400" />
            My Bill & QR
          </button>
        </div>

        {/* Action Exit Buttons */}
        <div>
          <button
            onClick={() => setIsPatronMode(false)}
            className="px-4 py-2.5 bg-white/5 border border-white/5 hover:border-orange-500/30 hover:bg-orange-500/5 text-gray-300 hover:text-orange-400 rounded-full text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-black/10"
          >
            🚪 Return to Staff Sign-In
          </button>
        </div>
      </header>

      {/* Table Ready-to-Order & Bartender Call Station */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 pt-6">
        <div className="bg-[#0c0c0c] border border-white/[0.04] p-5 rounded-3xl overflow-hidden shadow-2xl relative">
          {/* Subtle backgrounds */}
          <div className="absolute top-0 right-0 w-48 h-48 bg-orange-600/[0.02] rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-red-600/[0.01] rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 relative z-10">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] bg-orange-500/10 text-orange-400 font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full border border-orange-500/10">
                  📍 Table {(profile.tableNumber || 't1').toUpperCase()}
                </span>
                {profile.seatNumber && (
                  <span className="text-[10px] bg-white/5 text-gray-400 font-bold uppercase tracking-wider px-2 py-0.5 rounded-md">
                    Seat {profile.seatNumber}
                  </span>
                )}
              </div>

              <h2 className="text-sm font-black text-white uppercase tracking-wider mt-2.5 flex items-center gap-1.5">
                🍹 Ready to Order or Need Assistance?
              </h2>
              <p className="text-[10px] text-gray-400 font-medium leading-relaxed mt-1">
                Let the staff know your status directly. Choose to submit your local order cart instantly or call the bartender over.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
              {/* Option 2: Call Bartender Button */}
              <button
                disabled={isCallingBartender || tableAlerts.some(a => a.table.toLowerCase() === (profile.tableNumber || 't1').toLowerCase() && a.status === 'active' && a.type === 'call_bartender')}
                onClick={handleCallBartender}
                className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer border ${
                  tableAlerts.some(a => a.table.toLowerCase() === (profile.tableNumber || 't1').toLowerCase() && a.status === 'active' && a.type === 'call_bartender')
                    ? 'bg-red-950/20 border-red-500/20 text-red-400 cursor-not-allowed'
                    : 'bg-red-600/10 border-red-500/30 text-red-400 hover:bg-red-600 hover:text-white'
                }`}
              >
                <PhoneCall className={`w-3.5 h-3.5 ${tableAlerts.some(a => a.table.toLowerCase() === (profile.tableNumber || 't1').toLowerCase() && a.status === 'active' && a.type === 'call_bartender') ? 'animate-bounce' : ''}`} />
                {tableAlerts.some(a => a.table.toLowerCase() === (profile.tableNumber || 't1').toLowerCase() && a.status === 'active' && a.type === 'call_bartender')
                  ? 'Bell Ringing...'
                  : 'Call Bartender'}
              </button>

              {/* Option 1: Submit Order on Phone / Cart Shortcut */}
              <button
                onClick={() => {
                  setPatronSubTab('food');
                  addNotification("Review your food cart selection below or build your order!", "info");
                }}
                className="px-4 py-2.5 bg-orange-600 border border-orange-500 hover:bg-orange-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-orange-500/10"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                Submit Order on Phone
              </button>
            </div>
          </div>

          {/* Active alerts display */}
          {tableAlerts.some(a => a.table.toLowerCase() === (profile.tableNumber || 't1').toLowerCase() && a.status === 'active') && (
            <div className="mt-4 pt-4 border-t border-white/[0.04] flex flex-col gap-2">
              <span className="text-[8px] font-black uppercase tracking-wider text-orange-500">Active Service Tickets</span>
              <div className="flex flex-wrap gap-2">
                {tableAlerts.filter(a => a.table.toLowerCase() === (profile.tableNumber || 't1').toLowerCase() && a.status === 'active').map((a) => (
                  <div key={a.id} className="bg-white/5 border border-white/[0.06] rounded-lg px-2.5 py-1.5 flex items-center gap-2 text-[10px] text-gray-300">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span>
                      {a.type === 'call_bartender' ? '🔔 Waiter Call Sent' : '🍔 Phone Order Registered'}
                    </span>
                    <span className="text-[8px] font-mono text-gray-500">
                      {new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid View Contents */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 py-8">
        <AnimatePresence mode="wait">
          {patronSubTab === 'menu' ? (
            <motion.div
              key="menu"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              {/* Filter HUD Panel */}
              <div className="bg-[#0c0c0c]/90 border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden backdrop-blur-xl">
                <div className="absolute top-0 left-0 w-32 h-32 bg-orange-600/5 rounded-full blur-2xl pointer-events-none" />
                {/* Free Search */}
                <div className="relative w-full md:max-w-md">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search by name, ingredient, or recipe (e.g. Titos, Shot)..."
                    className="w-full bg-black/40 border border-white/5 rounded-2xl pl-12 pr-4 py-3 text-xs font-semibold text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 transition-all shadow-inner"
                  />
                </div>

                {/* Categories Scroll Area */}
                <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
                  <span className="text-[9px] font-black uppercase text-gray-500 mr-2 tracking-widest hidden md:inline">Filter Category:</span>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 max-w-full custom-scrollbar">
                    {DRINK_CATEGORIES.map(cat => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-3.5 py-1.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap border ${
                          selectedCategory === cat
                            ? 'bg-orange-500/10 text-orange-400 border-orange-500/30 font-black shadow-inner shadow-orange-500/5'
                            : 'bg-white/5 text-gray-400 border-transparent hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Toggles Container */}
                <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 shrink-0 items-start sm:items-center">
                  {/* Saved Only */}
                  <div className="flex items-center gap-3">
                    <label htmlFor="onlySavedCheck" className="text-[10px] font-black uppercase tracking-widest text-[#f2f2f2]/80 cursor-pointer select-none flex items-center gap-1">
                      <Heart className={`w-3 h-3 text-red-500 ${onlySaved ? 'fill-red-500' : ''}`} />
                      Saved Only
                    </label>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        id="onlySavedCheck"
                        checked={onlySaved}
                        onChange={e => setOnlySaved(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-white/[0.04] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-gray-400 peer-checked:after:bg-red-500 after:border-gray-600 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-500/10 peer-checked:border-red-500/30 h-6 shrink-0 transition-all" />
                    </label>
                  </div>

                  {/* Only Available Toggle Checker */}
                  <div className="flex items-center gap-3">
                    <label htmlFor="onlyInStockCheck" className="text-[10px] font-black uppercase tracking-widest text-[#f2f2f2]/80 cursor-pointer select-none">
                      Available Only
                    </label>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        id="onlyInStockCheck"
                        checked={onlyInStock}
                        onChange={e => setOnlyInStock(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-white/[0.04] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-gray-400 peer-checked:after:bg-orange-500 after:border-gray-600 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500/10 peer-checked:border-orange-500/30 h-6 shrink-0 transition-all" />
                    </label>
                  </div>
                </div>
              </div>

              {/* Dynamic Drinks Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence>
                  {filteredRecipes.map((recipe, idx) => {
                    const availability = getRecipeAvailability(recipe);
                    const isDrinkInStock = availability.allAvailable;
                    const estPrice = calculatePriceWithMargin(recipe);
                    const subResult = getRecipeSubstitutions(recipe);

                    return (
                      <motion.div
                        key={recipe.id}
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -10 }}
                        transition={{ duration: 0.25, delay: Math.min(idx * 0.03, 0.3) }}
                        className={`group bg-[#0b0b0b]/90 border rounded-[2rem] p-6 shadow-xl relative flex flex-col justify-between transition-all overflow-hidden ${
                          isDrinkInStock
                            ? 'border-white/[0.04] hover:border-orange-500/20 shadow-orange-500/1'
                            : 'border-red-500/10 hover:border-red-500/25 shadow-red-500/2 grayscale-[0.10]'
                        }`}
                      >
                        {/* Glow Gradient Card Background */}
                        <div className={`absolute top-0 right-0 w-36 h-36 rounded-full blur-3xl opacity-10 pointer-events-none ${
                          isDrinkInStock ? 'bg-orange-500' : 'bg-red-500'
                        }`} />

                        <div>
                          {/* Card Category Header */}
                          <div className="flex items-center justify-between mb-4">
                            <span className="text-[8px] font-black tracking-widest text-orange-500 uppercase bg-orange-500/5 px-2.5 py-1 rounded-full border border-orange-500/10">
                              {recipe.category || 'Cocktail'}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleSaveRecipe(recipe.id);
                                }}
                                className={`p-1.5 rounded-full border transition-all cursor-pointer flex items-center justify-center ${
                                  profile.savedRecipeIds.includes(recipe.id)
                                    ? 'bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20'
                                    : 'bg-white/5 border-transparent text-gray-500 hover:text-red-400 hover:bg-white/10'
                                }`}
                                title={profile.savedRecipeIds.includes(recipe.id) ? "Remove from Saved Recipes" : "Save to Profile"}
                              >
                                <Heart className={`w-3 h-3 ${profile.savedRecipeIds.includes(recipe.id) ? 'fill-red-500 text-red-500' : ''}`} />
                              </button>

                              {isDrinkInStock ? (
                                <span className="text-[8px] font-black tracking-widest uppercase text-green-400 bg-green-500/5 px-1.5 py-0.5 rounded border border-green-500/10 flex items-center gap-1 font-mono">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />
                                  Ready to Pour
                                </span>
                              ) : (
                                <span className="text-[8px] font-black tracking-widest uppercase text-red-400 bg-red-400/5 px-1.5 py-0.5 rounded border border-red-500/10 flex items-center gap-1 font-mono">
                                  Sold Out
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Recipe Title heading */}
                          <h3 className={`text-2xl font-black uppercase text-white tracking-tight leading-tight italic ${
                            recipe.favoritesCount ? 'mb-1' : 'mb-2'
                          }`}>
                            {recipe.name}
                          </h3>

                          {recipe.favoritesCount !== undefined && recipe.favoritesCount > 0 && (
                            <div className="flex items-center gap-1.5 mt-1 mb-3 bg-red-500/5 px-2.5 py-1 rounded-xl border border-red-500/10 w-fit">
                              <Heart className="w-2.5 h-2.5 text-red-500 fill-current animate-pulse shrink-0" />
                              <span className="text-[8px] font-black uppercase tracking-wider text-red-400 leading-none">
                                {recipe.favoritesCount} Sav{recipe.favoritesCount === 1 ? 'ed' : 'es'}
                              </span>
                            </div>
                          )}

                          {recipe.insight && (
                            <p className="text-[10px] text-gray-500 italic mb-4 leading-normal bg-black/20 p-2.5 rounded-xl border border-white/[0.02] truncate-2-lines">
                              "{recipe.insight}"
                            </p>
                          )}

                          {/* Ingredient Specs */}
                          <div className="space-y-2 mb-6">
                            <p className="text-[9px] font-black uppercase text-gray-500 tracking-wider">Required Ingredients:</p>
                            <div className="bg-black/35 p-3.5 rounded-2xl border border-white/[0.03] space-y-2">
                              {availability.ingredientDetails.map((ing, i) => {
                                const substituteName = getSubstituteForIngredient(ing.info.name);
                                return (
                                  <div key={i} className="flex flex-col gap-0.5 border-b border-white/[0.02] last:border-0 pb-1.5 last:pb-0">
                                    <div className="flex items-center justify-between text-xs font-semibold">
                                      <div className="flex items-center gap-2">
                                        {ing.info.inStock ? (
                                          <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
                                        ) : (
                                          <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                                        )}
                                        <span className={ing.info.inStock ? 'text-gray-300' : 'text-gray-500 line-through font-normal'}>
                                          {ing.rawName}
                                        </span>
                                      </div>
                                      <span className={`text-[10px] font-bold font-mono ${ing.info.inStock ? 'text-orange-400/80' : 'text-gray-600'}`}>
                                        {ing.amount}
                                      </span>
                                    </div>
                                    {!ing.info.inStock && substituteName && (
                                      <div className="pl-5 flex items-center gap-1">
                                        <span className="inline-block w-1 h-2 border-l border-b border-green-500/40 relative -top-[3.5px]" />
                                        <span className="text-[8px] font-black uppercase text-green-400 font-mono tracking-wider bg-green-500/5 px-1.5 py-0.5 rounded border border-green-500/10">
                                          Substitution: {substituteName}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Dynamic specifications details  */}
                          <div className="grid grid-cols-2 gap-2 text-[10px] font-bold mb-4">
                            <div className="bg-white/[0.02] p-2 rounded-xl border border-white/[0.03] flex flex-col justify-center">
                              <span className="text-[7px] font-black text-gray-500 uppercase tracking-widest leading-none mb-1">Glassware</span>
                              <span className="text-gray-300 truncate">{recipe.glassware || 'Standard Bar Glass'}</span>
                            </div>
                            <div className="bg-white/[0.02] p-2 rounded-xl border border-white/[0.03] flex flex-col justify-center">
                              <span className="text-[7px] font-black text-gray-500 uppercase tracking-widest leading-none mb-1">Recommended Garnish</span>
                              <span className="text-gray-300 truncate">{recipe.garnish || 'Fresh Lime'}</span>
                            </div>
                          </div>

                          {/* Patron Feedback Section */}
                          <div className="mt-2 pt-3 border-t border-white/[0.03] flex flex-col gap-2">
                            <div className="flex items-center justify-between text-[9px] font-black uppercase text-gray-500 tracking-wider">
                              <span>Guest Review</span>
                              {profile.ratings[recipe.id] && (
                                <span className={`flex items-center gap-1 font-extrabold ${
                                  profile.ratings[recipe.id].liked ? 'text-green-400' : 'text-red-400'
                                }`}>
                                  {profile.ratings[recipe.id].liked ? '👍 Liked' : '👎 Disliked'}
                                </span>
                              )}
                            </div>

                            {activeReviewingRecipeId === recipe.id ? (
                              <div className="bg-black/40 border border-white/5 p-3 rounded-2xl space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] text-gray-400 font-bold uppercase">Enjoyed this beverage?</span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setDraftLiked(true)}
                                      className={`p-1.5 rounded-xl border transition-all cursor-pointer ${
                                        draftLiked
                                          ? 'bg-green-500/10 border-green-500/30 text-green-400'
                                          : 'bg-white/5 border-transparent text-gray-500 hover:text-gray-300'
                                      }`}
                                    >
                                      <ThumbsUp className="w-3.5 h-3.5 fill-current" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDraftLiked(false)}
                                      className={`p-1.5 rounded-xl border transition-all cursor-pointer ${
                                        !draftLiked
                                          ? 'bg-red-500/10 border-red-500/30 text-red-400'
                                          : 'bg-white/5 border-transparent text-gray-500 hover:text-gray-300'
                                      }`}
                                    >
                                      <ThumbsDown className="w-3.5 h-3.5 fill-current" />
                                    </button>
                                  </div>
                                </div>

                                <input
                                  type="text"
                                  value={draftComment}
                                  onChange={(e) => setDraftComment(e.target.value)}
                                  placeholder="Leave optional custom feedback..."
                                  className="w-full bg-black/60 border border-white/5 rounded-xl px-3 py-2 text-[10px] text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 font-semibold"
                                />

                                <div className="flex gap-1.5 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setActiveReviewingRecipeId(null)}
                                    className="px-2 py-1 bg-white/5 hover:bg-white/10 text-[8px] font-black uppercase text-gray-400 hover:text-white rounded-lg transition-all cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleRateRecipe(recipe.id, draftLiked, draftComment);
                                      setActiveReviewingRecipeId(null);
                                    }}
                                    className="px-2 py-1 bg-gradient-to-r from-orange-600 to-orange-500 hover:brightness-110 text-[8px] font-black uppercase text-white rounded-lg transition-all cursor-pointer"
                                  >
                                    Submit
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                {profile.ratings[recipe.id] ? (
                                  <div className="flex-1 bg-black/25 border border-white/[0.02] p-2.5 rounded-xl flex items-center justify-between gap-2 overflow-hidden">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                      {profile.ratings[recipe.id].liked ? (
                                        <ThumbsUp className="w-3.5 h-3.5 text-green-400 shrink-0 fill-green-400" />
                                      ) : (
                                        <ThumbsDown className="w-3.5 h-3.5 text-red-400 shrink-0 fill-red-400" />
                                      )}
                                      <p className="text-[10px] text-gray-400 italic truncate font-semibold">
                                        {profile.ratings[recipe.id].comment || 'Satisfied selection'}
                                      </p>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                      <button
                                        onClick={() => {
                                          setDraftLiked(profile.ratings[recipe.id].liked);
                                          setDraftComment(profile.ratings[recipe.id].comment || '');
                                          setActiveReviewingRecipeId(recipe.id);
                                        }}
                                        className="text-gray-400 hover:text-orange-400 transition-all text-[8px] font-black uppercase cursor-pointer"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => handleRemoveRating(recipe.id)}
                                        className="text-gray-400 hover:text-red-400 transition-all text-[8px] font-black uppercase cursor-pointer"
                                      >
                                        Drop
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setDraftLiked(true);
                                      setDraftComment('');
                                      setActiveReviewingRecipeId(recipe.id);
                                    }}
                                    className="w-full py-2 bg-white/5 hover:bg-orange-500/5 border border-white/[0.04] hover:border-orange-500/10 text-gray-400 hover:text-orange-400 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                  >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    Provide Feedback
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Community Feedback reviews list */}
                            {recipe.reviews && recipe.reviews.length > 0 && (
                              <div className="mt-4 space-y-2 border-t border-white/[0.02] pt-3.5">
                                <span className="text-[7.5px] font-black uppercase text-orange-500 tracking-widest block leading-none">Community Reviews ({recipe.reviews.length})</span>
                                <div className="space-y-1.5 max-h-24 overflow-y-auto pr-0.5 animate-fade-in">
                                  {recipe.reviews.map((rev, rIdx) => (
                                    <div key={rIdx} className="bg-white/[0.01] border border-white/[0.02] p-2.5 rounded-xl text-[9px] space-y-1">
                                      <div className="flex justify-between items-center text-[7.5px] font-bold">
                                        <span className="text-gray-300 font-extrabold uppercase">{rev.userName}</span>
                                        <span className={`text-[7px] font-black uppercase tracking-widest ${rev.liked ? 'text-green-400' : 'text-red-400'}`}>
                                          {rev.liked ? '👍 Like' : '👎 Dislike'}
                                        </span>
                                      </div>
                                      {rev.comment && (
                                        <p className="text-gray-400 italic font-semibold leading-relaxed">"{rev.comment}"</p>
                                      )}
                                      <p className="text-[6.5px] text-gray-500 font-mono text-right">{rev.timestamp}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Mixer Selection Block (Option for Liquor Category) */}
                            {recipe.category === 'Liquor' && (
                              <div className="mt-4 pt-3.5 border-t border-white/[0.03] space-y-2 font-sans animate-fade-in bg-purple-500/[0.01] p-3 rounded-2xl border border-purple-500/[0.05]">
                                <span className="text-[8px] font-black uppercase text-purple-400 tracking-widest block leading-none flex items-center gap-1">
                                  <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                                  mixer add-on option:
                                </span>
                                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-0.5 scrollbar-thin scrollbar-thumb-purple-500/20">
                                  <button
                                    onClick={() => {
                                      setSelectedMixerForRecipe(prev => {
                                        const copy = { ...prev };
                                        delete copy[recipe.id];
                                        return copy;
                                      });
                                    }}
                                    className={`px-2.5 py-1.5 rounded-xl text-[8.5px] font-black uppercase tracking-wider transition-all cursor-pointer border ${
                                      !selectedMixerForRecipe[recipe.id]
                                        ? 'bg-purple-600/20 border-purple-500 text-purple-300 font-bold'
                                        : 'bg-white/5 border-transparent text-gray-400 hover:text-white hover:bg-white/10'
                                    }`}
                                  >
                                    Neat / Rocks (No Mixer)
                                  </button>
                                  {mixers.map(mixer => (
                                    <button
                                      key={mixer.n}
                                      onClick={() => {
                                        setSelectedMixerForRecipe(prev => ({
                                          ...prev,
                                          [recipe.id]: mixer.n
                                        }));
                                      }}
                                      className={`px-2.5 py-1.5 rounded-xl text-[8.5px] font-black uppercase tracking-wider transition-all cursor-pointer border ${
                                        selectedMixerForRecipe[recipe.id] === mixer.n
                                          ? 'bg-purple-600/20 border-purple-500 text-purple-300 font-bold'
                                          : 'bg-white/5 border-transparent text-gray-400 hover:text-white hover:bg-white/10'
                                      }`}
                                    >
                                      + {mixer.n}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                          </div>
                        </div>

                        {/* Card Bottom Area: Instructions Reveal & Ordering Options */}
                        <div className="pt-4 border-t border-white/[0.03] flex items-center justify-between gap-4">
                          <div>
                            <span className="text-[7px] font-black uppercase tracking-widest text-gray-500 block leading-none">Suggested Price</span>
                            <div className="flex items-center gap-1.5 mt-1">
                              {(() => {
                                const origVal = (() => {
                                  if (recipe.sellingPrice !== undefined && recipe.sellingPrice > 0) {
                                    return recipe.sellingPrice;
                                  }
                                  const cost = getRecipeCost(recipe);
                                  if (cost === 0) return 0;
                                  const cogs = pricingConfig?.cogsTarget || 0.25;
                                  const markup = pricingConfig?.markupFactor || 1.09;
                                  const calculatedPrice = (cost / cogs) * markup;
                                  return Math.max(5.50, Math.round(calculatedPrice * 2) / 2 - 0.05);
                                })();
                                const specRes = getSpecialDiscount(recipe.name, origVal, false);
                                if (specRes.hasSpecial) {
                                  return (
                                    <div className="flex flex-col gap-0.5">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-xs line-through text-gray-500 font-mono leading-none">
                                          ${Number(origVal).toFixed(2)}
                                        </span>
                                        <span className="text-lg font-black text-pink-500 font-mono italic block leading-none">
                                          ${Number(specRes.discountedPrice).toFixed(2)}
                                        </span>
                                      </div>
                                      <span className="text-[6.5px] bg-pink-500/10 text-pink-400 font-bold border border-pink-500/10 px-1 py-0.5 rounded uppercase tracking-wider self-start leading-none mt-0.5">
                                        {specRes.specialPeriod} Special 🎉
                                      </span>
                                    </div>
                                  );
                                }
                                return (
                                  <span className="text-lg font-black text-orange-500 font-mono italic block leading-none">
                                    ${Number(estPrice).toFixed(2)}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>

                          <div className="flex gap-2">
                            {/* Toggle Instructions dropdown */}
                            <button
                              onClick={() => setFocusedRecipeId(focusedRecipeId === recipe.id ? null : recipe.id)}
                              className="px-3.5 py-2.5 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer shadow flex items-center gap-1"
                            >
                              Instructions
                            </button>

                            {isDrinkInStock ? (
                              <button
                                onClick={() => {
                                  setActiveSubstitutions({});
                                  setOrderingRecipe(recipe);
                                }}
                                className="px-4 py-2.5 bg-gradient-to-r from-orange-600 to-orange-500 hover:brightness-110 text-white font-extrabold rounded-xl text-[9px] font-black uppercase tracking-widest transition-all shadow-md shadow-orange-500/10 cursor-pointer flex items-center gap-1"
                              >
                                Request Drink
                              </button>
                            ) : subResult.hasSubstitutions ? (
                              <button
                                onClick={() => {
                                  setActiveSubstitutions(subResult.substitutions);
                                  setOrderingRecipe(recipe);
                                }}
                                className="px-4 py-2.5 bg-gradient-to-r from-green-700 to-green-600 hover:brightness-110 text-white font-extrabold rounded-xl text-[9px] font-black uppercase tracking-widest transition-all shadow-md shadow-green-500/10 cursor-pointer flex items-center gap-1 whitespace-nowrap"
                                title="Substitute missing ingredients with available spirits"
                              >
                                Order with Subs
                              </button>
                            ) : (
                              <button
                                disabled
                                className="px-4 py-2.5 bg-white/5 border border-white/5 text-gray-600 rounded-xl text-[9px] font-black uppercase tracking-widest cursor-not-allowed"
                              >
                                Unavailable
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Alternative Recommendation Section if unavailable */}
                        {!isDrinkInStock && (
                          <div className="mt-4 pt-3 border-t border-white/[0.03] space-y-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[7.5px] font-black uppercase text-gray-500 tracking-wider">Alternative suggestions:</span>
                              <span className="bg-green-500/10 border border-green-500/20 text-green-400 text-[6px] font-black uppercase tracking-widest px-1 py-0.2 rounded font-mono">
                                In Stock
                              </span>
                            </div>
                            
                            {getRecipeAlternatives(recipe).length > 0 ? (
                              <div className="flex gap-2 font-sans">
                                {getRecipeAlternatives(recipe).map(alt => (
                                  <button
                                    key={alt.id}
                                    onClick={() => {
                                      setActiveSubstitutions({});
                                      setOrderingRecipe(alt);
                                    }}
                                    className="flex-1 px-2 py-1.5 bg-white/[0.02] border border-white/5 hover:border-orange-500/20 text-[8.5px] font-black uppercase text-gray-400 hover:text-white rounded-xl transition-all truncate text-center cursor-pointer"
                                    title={`Try ${alt.name} instead`}
                                  >
                                    {alt.name}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[8px] font-semibold text-gray-600 italic lowercase">no matching alternatives in stock</p>
                            )}
                          </div>
                        )}

                        {/* Expanded instructions menu */}
                        {focusedRecipeId === recipe.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="w-full mt-4 p-4 bg-black/60 border border-white/5 rounded-2xl text-xs text-gray-300 italic font-medium leading-relaxed"
                          >
                            <p className="text-[8px] font-black uppercase text-orange-400 not-italic tracking-widest mb-1.5">Preparation Method:</p>
                            "{recipe.instructions || 'Standard assembly'}"
                            {recipe.barNotes && (
                              <div className="mt-2.5 pt-2 border-t border-white/5 space-y-0.5">
                                <p className="text-[8px] font-black uppercase text-amber-500 not-italic tracking-widest">Bar Prep Notes:</p>
                                <p className="not-italic text-[10px] text-amber-400/90 font-medium font-sans">"{recipe.barNotes}"</p>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                
                {filteredRecipes.length === 0 && (
                  <div className="col-span-full py-24 text-center bg-black/20 border border-dashed border-white/5 rounded-[3rem] px-8">
                    <Wine className="w-12 h-12 text-gray-700 mx-auto mb-6 opacity-40" />
                    <h3 className="text-xl font-black text-gray-300 uppercase italic">No Recipes Match Your Filters</h3>
                    <p className="text-xs text-gray-500 max-w-sm mx-auto mt-2 leading-relaxed">
                      We couldn't locate any drinks on the active menu fitting those parameters. Try clearing search keywords or switching off "Available Drinks Only"!
                    </p>
                    <button
                      onClick={() => { setSearchQuery(''); setSelectedCategory('All'); setOnlyInStock(false); }}
                      className="mt-6 px-5 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-[9px] font-black uppercase tracking-widest text-[#f2f2f2] rounded-xl transition-all"
                    >
                      Reset Menu Search Filters
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ) : patronSubTab === 'mix' ? (
            <motion.div
              key="mix"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="grid lg:grid-cols-12 gap-8 items-start"
            >
              {/* Left Side: Recipe Shaker Assembly Form (7 Cols) */}
              <div className="lg:col-span-7 bg-[#0c0c0c]/85 border border-white/5 rounded-[3rem] p-6 lg:p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl">
                <div className="absolute top-0 left-0 w-24 h-24 bg-orange-600/5 rounded-full blur-xl pointer-events-none" />
                
                <div className="flex items-center gap-3 border-b border-white/[0.04] pb-5 mb-6">
                  <div className="w-10 h-10 bg-orange-600/10 rounded-xl border border-orange-500/20 flex items-center justify-center text-orange-500 animate-pulse">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black uppercase tracking-widest italic leading-none">Interactive Shaker</h2>
                    <p className="text-[9px] font-bold text-gray-500 uppercase tracking-tighter mt-1">Concoct a recipe using ingredients physically in stock</p>
                  </div>
                </div>

                <form onSubmit={handlePublishCustomRecipe} className="space-y-6">
                  {/* Row 1: Cocktail Name */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block ml-1">Cocktail / Shot Name</label>
                      <input
                        type="text"
                        required
                        value={mixName}
                        onChange={e => setMixName(e.target.value)}
                        placeholder="e.g., Midnight Nitro Spark"
                        className="w-full bg-black/40 border border-white/5 rounded-2xl p-3 text-sm font-bold text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-all font-sans"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block ml-1">Lounge Category</label>
                      <select
                        value={mixCategory}
                        onChange={e => setMixCategory(e.target.value)}
                        className="w-full bg-[#121212] border border-white/5 rounded-2xl p-3 text-sm font-bold text-white focus:border-orange-500 outline-none transition-all font-sans"
                      >
                        <option value="Cocktail">Cocktail Shaker</option>
                        <option value="Shot">Direct Teaser / Shot</option>
                        <option value="Specialty">Seasonal Specialty</option>
                        <option value="Non-Alcoholic">Zero Proof (Non-Alcoholic)</option>
                      </select>
                    </div>
                  </div>

                  {/* Row 2: Glassware and Garnish */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block ml-1">Vessel / Glassware Size</label>
                      <select
                        value={mixGlass}
                        onChange={e => setMixGlass(e.target.value)}
                        className="w-full bg-[#121212] border border-white/5 rounded-2xl p-3 text-sm font-bold text-white focus:border-orange-500 outline-none transition-all font-sans"
                      >
                        <option value="Highball Glass">Tall Highball Glass</option>
                        <option value="Rocks Glass">Low Rocks Tumbler</option>
                        <option value="Martini Coupe">V-Shaped Martini Coupe</option>
                        <option value="Shot Glass">Standard 1.5 oz Shot Glass</option>
                        <option value="Beer Snifter">Bulbous Beer Snifter</option>
                        <option value="Copper Mug">Chilled Copper Mug</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block ml-1">Finishing touch / Garnish</label>
                      <select
                        value={mixGarnish}
                        onChange={e => setMixGarnish(e.target.value)}
                        className="w-full bg-[#121212] border border-white/5 rounded-2xl p-3 text-sm font-bold text-white focus:border-orange-500 outline-none transition-all font-sans"
                      >
                        <option value="Lime Wedge">Fresh Lime Wedge</option>
                        <option value="Lemon Twist">Zesty Lemon Twist</option>
                        <option value="Cherry & Orange">Candied Maraschino & Orange</option>
                        <option value="Mint Sprig">Aromatic Slapped Mint Sprig</option>
                        <option value="Salt Rim">Coarse Sea Salt Rim</option>
                        <option value="Sugar Rim">Glazed Raw Cane Sugar Rim</option>
                        <option value="Cocktail Pickle/Olive">Spiced Cocktail Olive & Pickle</option>
                        <option value="None">No Garnish (Clean Serves)</option>
                      </select>
                    </div>
                  </div>

                  {/* Row 3: Dynamic Ingredients Mixer strictly IN STOCK */}
                  <div className="space-y-3 pt-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block ml-1">Select Pour Ingredients</label>
                      <span className="text-[8px] font-black uppercase text-green-400 py-0.5 px-2 bg-green-500/5 border border-green-500/10 rounded-full font-mono">
                        {inStockIngredients.length} Brands physically In-Stock
                      </span>
                    </div>

                    <div className="space-y-3 bg-black/40 p-4 rounded-3xl border border-white/5">
                      {mixIngredients.map((ing, index) => (
                        <div key={index} className="flex gap-3 items-center">
                          {/* Search Dropdown populate IN STOCK ONLY */}
                          <div className="flex-1">
                            <select
                              required
                              value={ing.item}
                              onChange={e => handleUpdateMixIngredient(index, { item: e.target.value })}
                              className="w-full bg-[#121212] border border-white/5 rounded-2xl p-3 text-xs font-bold text-white focus:border-orange-500 outline-none transition-all"
                            >
                              <option value="">-- Choose In-Stock Ingredient --</option>
                              {inStockIngredients.map(item => (
                                <option key={item.n} value={item.n}>
                                  {item.n} (Available: {stock[item.n] ?? 0} bottles)
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Amount specifications */}
                          <div className="w-28">
                            <select
                              value={ing.amount}
                              onChange={e => handleUpdateMixIngredient(index, { amount: e.target.value })}
                              className="w-full bg-[#121212] border border-white/5 rounded-2xl p-3 text-xs font-black text-center text-orange-400 focus:border-orange-500 outline-none transition-all"
                            >
                              <option value="0.25 oz">0.25 oz</option>
                              <option value="0.5 oz">0.5 oz</option>
                              <option value="0.75 oz">0.75 oz</option>
                              <option value="1.0 oz">1.0 oz</option>
                              <option value="1.25 oz">1.25 oz</option>
                              <option value="1.5 oz">1.5 oz/Jigger</option>
                              <option value="2.0 oz">2.0 oz</option>
                              <option value="2.5 oz">2.5 oz</option>
                              <option value="3.0 oz">3.0 oz</option>
                              <option value="1 Dash">1 Dash</option>
                              <option value="2 Dashes">2 Dashes</option>
                              <option value="Top with">Top with</option>
                              <option value="Splash">Splash</option>
                            </select>
                          </div>

                          {/* Delete row button */}
                          <button
                            type="button"
                            disabled={mixIngredients.length <= 1}
                            onClick={() => handleRemoveMixIngredient(index)}
                            className="p-3 bg-red-950/20 hover:bg-red-500 border border-red-900/40 hover:border-red-500 rounded-2xl text-red-400 hover:text-white transition-all cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                            title="Remove Brand"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}

                      {/* Add Brand button */}
                      <button
                        type="button"
                        onClick={handleAddMixIngredient}
                        className="w-full py-2.5 border border-dashed border-white/10 hover:border-orange-500/45 text-[9px] font-black uppercase tracking-widest text-[#f2f2f2]/60 hover:text-orange-400 rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Mix Ingredient
                      </button>
                    </div>
                  </div>

                  {/* Row 4: Preparation details */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block ml-1">Stirring Instructions / Method</label>
                      <span className="text-[8px] text-gray-600 font-bold uppercase mr-1">Optional specifications</span>
                    </div>
                    <textarea
                      value={mixInstructions}
                      onChange={e => setMixInstructions(e.target.value)}
                      placeholder="e.g. Combine vodka, lemon, shake contents aggressively over ice, strain into premium chilled coup glass..."
                      rows={3}
                      className="w-full bg-black/40 border border-white/5 rounded-2xl p-3 text-xs font-medium text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-all font-sans resize-none"
                    />
                  </div>

                  {/* Complete Action Buttons */}
                  <div className="pt-2">
                    <button
                      type="submit"
                      className="w-full py-4 bg-gradient-to-r from-orange-600 to-orange-500 hover:brightness-110 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:shadow-lg active:scale-[0.98] transition-all shadow-lg shadow-orange-600/25 flex items-center justify-center gap-2 font-bold cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-white" />
                      Seal Shaker & Publish Cocktail
                    </button>
                  </div>
                </form>
              </div>

              {/* Right Side: Virtual Beverage Coaster Live View (5 Cols) */}
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-[#0c0c0c]/90 border border-white/5 rounded-[3rem] p-6 text-center shadow-2xl relative overflow-hidden flex flex-col items-center">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-orange-600/5 rounded-full blur-xl pointer-events-none" />
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-500 mb-6 font-semibold">Tasting Glass Specimen</p>

                  {/* Live Render Glass Component */}
                  <div className="w-44 h-44 bg-black/40 border border-white/5 rounded-[2.5rem] flex items-center justify-center relative mb-6 shadow-inner">
                    <div className="absolute inset-0 pointer-events-none opacity-5 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.3)_50%,transparent_75%)] animate-[pulse_3s_infinite]" />
                    {/* Glowing dynamic background indicating type */}
                    <div className="absolute w-32 h-32 bg-orange-500/10 rounded-full blur-2xl animate-pulse" />

                    {/* Interactive Glass graphic */}
                    <svg viewBox="0 0 100 100" className="w-28 h-28 drop-shadow-[0_8px_16px_rgba(249,115,22,0.15)] relative">
                      {/* Garnish representation on top left edge */}
                      {mixGarnish !== "None" && (
                        <g>
                          <ellipse cx="32" cy="18" rx="8" ry="3" fill="#bef264" transform="rotate(-30 32 18)" />
                          <circle cx="34" cy="20" r="1.5" fill="#e11d48" />
                        </g>
                      )}

                      {/* Glass Shaper bases */}
                      {mixGlass === "Martini Coupe" ? (
                        <>
                          <polygon points="50,65 50,85" stroke="#444" strokeWidth="2.5" />
                          <polygon points="40,85 60,85" stroke="#444" strokeWidth="2.5" />
                          {/* Liquid content polygon */}
                          <polygon points="34,44 66,44 50,65" fill={mixIngredients[0]?.item ? "url(#drinkGrad)" : "rgba(255,255,255,0.03)"} className="transition-all duration-500" />
                          <polygon points="30,40 70,40 50,65" stroke="#f2f2f2" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                        </>
                      ) : mixGlass === "Shot Glass" ? (
                        <>
                          {/* Liquid content inside glass */}
                          <rect x="42" y="52" width="16" height="28" rx="1" fill={mixIngredients[0]?.item ? "url(#drinkGrad)" : "rgba(255,255,255,0.03)"} className="transition-all duration-500" />
                          <rect x="40" y="48" width="20" height="34" rx="2" stroke="#f2f2f2" strokeWidth="2.5" fill="none" />
                        </>
                      ) : mixGlass === "Rocks Glass" ? (
                        <>
                          {/* Liquid content */}
                          <rect x="37" y="42" width="26" height="38" rx="2" fill={mixIngredients[0]?.item ? "url(#drinkGrad)" : "rgba(255,255,255,0.03)"} className="transition-all duration-500" />
                          <rect x="35" y="38" width="30" height="44" rx="3" stroke="#f2f2f2" strokeWidth="2.5" fill="none" />
                        </>
                      ) : ( // Highball (Default)
                        <>
                          {/* Straw */}
                          <line x1="62" y1="20" x2="52" y2="75" stroke="#f43f5e" strokeWidth="1.5" />
                          {/* Liquid content inside */}
                          <rect x="38" y="36" width="24" height="46" rx="2" fill={mixIngredients[0]?.item ? "url(#drinkGrad)" : "rgba(255,255,255,0.03)"} className="transition-all duration-500" />
                          {/* Glass frame */}
                          <rect x="36" y="30" width="28" height="54" rx="3.5" stroke="#f2f2f2" strokeWidth="2.5" fill="none" />
                        </>
                      )}

                      {/* Gradients */}
                      <defs>
                        <linearGradient id="drinkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#f97316" stopOpacity="0.85" />
                          <stop offset="50%" stopColor="#ec4899" stopOpacity="0.85" />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.85" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>

                  <h3 className="text-xl font-black text-white italic tracking-wide truncate max-w-full">
                    {mixName || 'New Shaker Creation'}
                  </h3>
                  <div className="flex gap-2 items-center justify-center mt-2 flex-wrap">
                    <span className="text-[8px] tracking-widest uppercase font-black px-2 py-0.5 bg-white/5 text-gray-400 border border-white/5 rounded">
                      {mixGlass}
                    </span>
                    <span className="text-[8px] tracking-widest uppercase font-black px-2 py-0.5 bg-orange-500/10 text-orange-400 border border-orange-500/10 rounded">
                      {mixCategory}
                    </span>
                  </div>

                  {/* Estimated Pricing specifications */}
                  <div className="w-full mt-6 bg-black/40 border border-white/5 rounded-2xl p-4 text-center">
                    <span className="text-[8px] font-black uppercase tracking-widest text-[#f97316]/80 block leading-none">Suggested Price</span>
                    <span className="text-2xl font-black text-orange-500 font-mono italic mt-2 block">
                      ${estimatedCustomPrice.toFixed(2)}
                    </span>
                  </div>

                  <p className="text-[8px] text-gray-500 uppercase mt-4 text-center leading-normal max-w-xs">
                    💡 Price is computed based on selected custom ingredients, margins, and pour measurements.
                  </p>
                </div>

                {/* Status card when a drink takes place */}
                <AnimatePresence>
                  {submittedDrink && (
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      className="bg-green-950/20 border border-green-500/30 rounded-[2.5rem] p-6 text-center space-y-4 shadow-xl"
                    >
                      <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white mx-auto shadow-md">
                        <Check className="w-6 h-6 stroke-[3]" />
                      </div>
                      <div>
                        <h4 className="text-xl font-black uppercase tracking-wide text-white italic">Drink Transmitted!</h4>
                        <p className="text-[10px] text-gray-400 uppercase mt-1">Concoction ID: {submittedDrink.id}</p>
                      </div>
                      <p className="text-xs text-gray-300 leading-relaxed font-medium">
                        "${submittedDrink.name}" has been published to the active bar recipe manual! Make your way to the counter and state your recipe name to the bartender to enjoy.
                      </p>
                      <button
                        onClick={() => {
                          setSubmittedDrink(null);
                          setPatronSubTab('menu');
                        }}
                        className="px-5 py-2 bg-green-500 hover:bg-green-600 text-white text-[9px] font-black uppercase rounded-xl transition-all font-black shadow"
                      >
                        Back to Drink Menu
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          ) : patronSubTab === 'ai-mixologist' ? (
            <motion.div
              key="ai-mixologist"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="grid lg:grid-cols-12 gap-8 items-start"
            >
              {/* Left Column: Mixer Preferences & Ingredients Select (5 Cols) */}
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-[#0c0c0c]/85 border border-white/5 rounded-[3rem] p-6 lg:p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl">
                  <div className="absolute top-0 left-0 w-24 h-24 bg-orange-600/5 rounded-full blur-xl pointer-events-none" />
                  
                  <div className="flex items-center gap-3 border-b border-white/[0.04] pb-5 mb-6">
                    <div className="p-2 bg-orange-600/10 rounded-xl border border-orange-500/20 text-orange-500">
                      <Sparkles className="w-5 h-5 text-orange-500 animate-pulse" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black uppercase tracking-widest italic leading-none">Drafting Station</h2>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter mt-1">Configure your personalized AI drink parameters</p>
                    </div>
                  </div>

                  {/* Flavor Preference Select */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-orange-500 block ml-1">1. Choose Flavor Vibe</label>
                      <select
                        value={aiPreference}
                        onChange={e => setAiPreference(e.target.value)}
                        className="w-full bg-[#121212] border border-white/5 rounded-2xl p-3 text-sm font-bold text-white focus:border-orange-500 outline-none transition-all font-sans"
                      >
                        <option value="Rugged Firefighter Vibe">Rugged Firefighter Vibe (Bold & Characterful)</option>
                        <option value="Sweet & Fruity">Sweet & Fruity Twist</option>
                        <option value="Sour & Citrusy">Sour & Citrusy Zap</option>
                        <option value="Smoky & Bold">Smoky & Bold Embers</option>
                        <option value="Bitter & Spirit-Forward">Bitter & Spirit-Forward (Dry)</option>
                        <option value="Crisp & Refreshing">Crisp & Refreshing Hydrolator</option>
                        <option value="Zero-Proof Protection">Zero-Proof Protection (Non-Alcoholic)</option>
                      </select>
                    </div>

                    {/* Custom prompt request */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-orange-500 block ml-1">2. Custom Specifications (Optional)</label>
                      <textarea
                        value={customAiPrompt}
                        onChange={e => setCustomAiPrompt(e.target.value)}
                        placeholder="e.g. Include cucumber, no sugar, make it extra sour, or served hot..."
                        rows={2}
                        className="w-full bg-black/40 border border-white/5 rounded-2xl p-3 text-xs font-medium text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-all font-sans resize-none"
                      />
                    </div>

                    {/* Ingredient lockdown list */}
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black uppercase tracking-widest text-orange-500 block ml-1">3. Select Active Shelf Priorities</label>
                        <button 
                          onClick={() => setSelectedAiIngredients([])}
                          className="text-[8px] uppercase tracking-widest font-black text-gray-500 hover:text-white transition-all cursor-pointer"
                        >
                          Reset to All
                        </button>
                      </div>

                      <div className="max-h-60 overflow-y-auto bg-black/40 rounded-2xl p-3 border border-white/5 space-y-1.5 custom-scrollbar2">
                        {inStockIngredients.length === 0 ? (
                          <div className="text-center py-4 text-gray-500 text-[10px] font-bold uppercase">No physical items on shelf in-stock!</div>
                        ) : (
                          inStockIngredients.map(item => {
                            const isSelected = selectedAiIngredients.includes(item.n);
                            return (
                              <label
                                key={item.n}
                                className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all cursor-pointer ${
                                  isSelected 
                                    ? 'bg-orange-500/10 border-orange-500/25 text-white' 
                                    : 'bg-transparent border-transparent text-gray-400 hover:bg-white/[0.02]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  checked={isSelected}
                                  onChange={() => {
                                    if (isSelected) {
                                      setSelectedAiIngredients(prev => prev.filter(name => name !== item.n));
                                    } else {
                                      setSelectedAiIngredients(prev => [...prev, item.n]);
                                    }
                                  }}
                                />
                                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${
                                  isSelected ? 'border-orange-500 bg-orange-500 text-white' : 'border-white/20'
                                }`}>
                                  {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-black uppercase tracking-tight truncate leading-none">{item.n}</p>
                                  <span className="text-[7.5px] font-mono font-bold text-gray-500 block mt-1">Available: {stock[item.n] ?? 0} bottles</span>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>
                      <p className="text-[8px] text-gray-500 uppercase ml-1 italic">
                        Select specific items to lock recommendations to, or leave unchecked to let the AI explore our full in-stock backbar shelf.
                      </p>
                    </div>

                    {/* Action Generation Button */}
                    <div className="pt-4">
                      <button
                        onClick={handleGenerateAiCocktails}
                        disabled={isAiGenerating}
                        className="w-full py-4 bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:shadow-lg active:scale-[0.98] transition-all shadow-lg shadow-orange-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Sparkles className={`w-4 h-4 text-white ${isAiGenerating ? 'animate-spin' : 'animate-pulse'}`} />
                        {isAiGenerating ? 'Drafting Spark mixes...' : 'Mobilize AI Mixologist'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Suggested Recipes Dashboard / Card Deck (7 Cols) */}
              <div className="lg:col-span-7 space-y-6">
                {aiSuccessMessage && (
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="p-4 bg-green-500/10 border border-green-500/25 rounded-2xl flex items-center justify-between gap-3 text-green-400 text-xs font-bold uppercase tracking-tight"
                  >
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 stroke-[3]" />
                      <span>{aiSuccessMessage}</span>
                    </div>
                    <button 
                      onClick={() => setAiSuccessMessage(null)} 
                      className="text-[9px] font-black text-gray-400 hover:text-white cursor-pointer"
                    >
                      Clear
                    </button>
                  </motion.div>
                )}

                <AnimatePresence mode="wait">
                  {isAiGenerating ? (
                    <motion.div
                      key="ai-loading"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-[#0c0c0c]/90 border border-white/5 rounded-[3rem] p-12 text-center shadow-2xl relative overflow-hidden flex flex-col items-center justify-center min-h-[450px]"
                    >
                      <div className="absolute top-0 right-0 w-36 h-36 bg-orange-600/15 rounded-full blur-3xl animate-pulse" />
                      <div className="w-24 h-24 rounded-full border border-dashed border-orange-500/30 flex items-center justify-center relative mb-6 animate-spin">
                        <Sparkles className="w-8 h-8 text-orange-500 animate-pulse" />
                      </div>
                      <div className="space-y-2 max-w-sm">
                        <h4 className="text-lg font-black uppercase tracking-widest italic text-white leading-none">Blasting Shaker Chambers...</h4>
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest h-5 leading-normal">Checking physical ingredient bottle counts</p>
                      </div>
                      <p className="text-xs text-gray-400 italic max-w-md leading-relaxed mt-6 bg-white/[0.02] border border-white/5 p-4 rounded-2xl">
                        "Drafting liquid formulations. Securing premium firefighter lounge glass specs... Please hold."
                      </p>
                    </motion.div>
                  ) : generatedDrinks.length > 0 ? (
                    <motion.div
                      key="ai-results"
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-6"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-black uppercase text-orange-500 tracking-[0.2em]">Crafted Formulations</h3>
                        <span className="text-[8px] font-mono text-gray-500 uppercase font-black">3 custom recipes made</span>
                      </div>

                      {generatedDrinks.map((drink, idx) => {
                        const recPrice = calculatePriceWithMargin({
                          id: 'temp',
                          name: drink.name,
                          ingredients: drink.ingredients,
                          instructions: drink.instructions,
                          category: 'Specialty'
                        });

                        return (
                          <motion.div
                            key={drink.name}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            className="bg-[#0b0b0b]/95 border border-white/5 rounded-[2.5rem] p-6 shadow-xl relative overflow-hidden flex flex-col md:flex-row gap-6 hover:border-orange-500/20 transition-all select-none"
                          >
                            <div className="absolute top-0 right-0 w-36 h-36 bg-orange-500/5 rounded-full blur-3xl pointer-events-none" />
                            
                            {/* Left Side Info Details */}
                            <div className="flex-1 space-y-4">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[8px] font-black uppercase tracking-widest bg-orange-600/10 text-orange-400 px-2 py-0.5 rounded border border-orange-500/20 inline-block">
                                    {drink.category || 'Cocktail'}
                                  </span>
                                  <span className="text-[7.5px] font-mono text-gray-500 uppercase tracking-widest font-black">
                                    AI Draft Suggestion
                                  </span>
                                </div>
                                <h4 className="text-lg font-black uppercase tracking-wide tracking-widest text-white italic leading-tight">
                                  {drink.name}
                                </h4>
                              </div>

                              {/* Ingredients items list */}
                              <div className="space-y-1.5 bg-black/40 p-3 rounded-2xl border border-white/5">
                                <h5 className="text-[8.5px] font-black uppercase text-gray-500 tracking-wider">Formula Ingredients:</h5>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                  {drink.ingredients && drink.ingredients.map((ing: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between text-[11px] font-bold text-gray-300">
                                      <span className="truncate mr-1">{ing.item}</span>
                                      <span className="text-orange-400 shrink-0 font-mono font-black">{ing.amount}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Story / Insight */}
                              {drink.insight && (
                                <div className="text-[10.5px] font-medium text-gray-400 bg-white/[0.01] border border-white/[0.03] p-3 rounded-2xl italic leading-relaxed">
                                  💡 {drink.insight}
                                </div>
                              )}
                            </div>

                            {/* Right Side instructions & actions */}
                            <div className="w-full md:w-56 md:border-l border-white/[0.04] md:pl-6 flex flex-col justify-between gap-4">
                              <div className="space-y-1.5">
                                <h5 className="text-[8.5px] font-black uppercase text-gray-500 tracking-wider">Instructions:</h5>
                                <p className="text-[10px] font-normal text-gray-400 leading-normal line-clamp-5 hover:line-clamp-none transition-all">
                                  {drink.instructions}
                                </p>
                              </div>

                              <div className="space-y-1 pt-2">
                                <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-gray-500 px-1 mb-1">
                                  <span>Suggested Price</span>
                                  <span className="text-orange-500 font-mono italic text-sm font-black">${recPrice > 0 ? recPrice.toFixed(2) : '12.00'}</span>
                                </div>

                                <div className="flex gap-2 w-full">
                                  <button
                                    onClick={() => handlePublishAiDrink(drink)}
                                    className="flex-1 py-2.5 bg-[#151515] border border-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1"
                                    title="Add to general lounge recipe list"
                                  >
                                    <Plus className="w-3 h-3 text-orange-500" />
                                    Publish
                                  </button>
                                  <button
                                    onClick={() => handleOrderAiDrink(drink)}
                                    className="flex-1 py-2.5 bg-gradient-to-r from-orange-600 to-orange-550 hover:brightness-110 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-md transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1 shadow-orange-500/10 animate-pulse"
                                    title="Order this drink now"
                                  >
                                    <Wine className="w-3 h-3 text-white" />
                                    Order Drink
                                  </button>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="ai-intro"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-[#0c0c0c]/85 border border-white/5 rounded-[3rem] p-10 text-center shadow-2xl relative overflow-hidden flex flex-col items-center justify-center min-h-[450px]"
                    >
                      <div className="absolute top-0 right-0 w-36 h-36 bg-orange-600/5 rounded-full blur-3xl pointer-events-none" />
                      <div className="w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-500 mb-6 animate-bounce">
                        <Sparkles className="w-7 h-7" />
                      </div>
                      <h4 className="text-xl font-black uppercase tracking-widest italic text-white leading-none">Automated Liquid Station</h4>
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">Direct backbar stock synthesis engine</p>
                      
                      <div className="space-y-4 max-w-sm text-center leading-relaxed text-xs text-gray-400 mt-6">
                        <p>
                          Our state-of-the-art AI mixology module analyzes exactly which physical liquor assets and mixer inventory bottles are physically available on our lounge back shelves right now.
                        </p>
                        <p>
                          Configure your favorite profiles such as <strong>Smoky Bold Embers</strong> or specify custom ingredient lockdowns, and the mixology node will render 3 completely original and ready-to-pour cocktail specs!
                        </p>
                      </div>

                      <div className="border border-white/5 bg-white/[0.01] p-3 rounded-2xl text-[9.5px] font-black uppercase tracking-wider text-orange-500/90 mt-6 flex items-center gap-2">
                        <span>⚡ {inStockIngredients.length} Brands Available Tonight</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          ) : patronSubTab === 'food' ? (
            <motion.div
              key="food"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="grid lg:grid-cols-12 gap-8 items-start"
            >
              {/* Left Main Side: Food Catalog (7 Columns) */}
              <div className="lg:col-span-7 space-y-6">
                {/* Food Header Menu Filter HUD */}
                <div className="bg-[#0c0c0c]/90 border border-white/5 rounded-3xl p-5 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4 relative overflow-hidden backdrop-blur-xl">
                  <div className="absolute top-0 left-0 w-24 h-24 bg-orange-600/5 rounded-full blur-xl pointer-events-none" />
                  
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center bg-orange-600/10 border border-orange-500/20">
                      {brandingConfig?.logoUrl ? (
                        <img src={brandingConfig.logoUrl} className="w-full h-full object-contain" alt="Brand Logo" referrerPolicy="no-referrer" />
                      ) : (
                        <Utensils className="w-4 h-4 text-orange-500" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-widest text-white leading-none">{brandingConfig?.foodMenuTitle || `${brandingConfig?.brandName || "Smoke Eaters"} Food Menu`}</h3>
                      <p className="text-[8.5px] font-bold text-gray-500 uppercase tracking-tighter mt-1">{brandingConfig?.tagline || "Live hickory fired plates"}</p>
                    </div>
                  </div>

                  {/* Food Category Scroll Buttons */}
                  <div className="flex gap-1.5 overflow-x-auto pb-1 max-w-full custom-scrollbar">
                    {['All', 'Appetizers', 'Smoked Mains', 'Wood-Fired Pizzas', 'Lighter Side', 'Desserts'].map(cat => (
                      <button
                        key={cat}
                        onClick={() => setSelectedFoodCategory(cat)}
                        className={`px-3 py-1.5 rounded-full text-[8.5px] font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap border ${
                          selectedFoodCategory === cat
                            ? 'bg-orange-500/10 text-orange-400 border-orange-500/30 font-black shadow-inner'
                            : 'bg-white/5 text-gray-400 border-transparent hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Food Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {FOOD_MENU.filter(item => selectedFoodCategory === 'All' || item.category === selectedFoodCategory)
                    .map(item => {
                      const cartQty = foodCart[item.id] ?? 0;
                      
                      // Check dynamic stock constraints
                      const physicalStock = item.associatedStockItem ? (stock[item.associatedStockItem] ?? 0) : null;
                      const hasStockLink = physicalStock !== null;
                      const isOutOfStock = hasStockLink && physicalStock <= 0;
                      const isProductAvailable = item.isAvailable && !isOutOfStock;
                      const foodAlts = getFoodAlternatives(item);

                      return (
                        <div
                          key={item.id}
                          className={`bg-[#0b0b0b]/95 border rounded-[2rem] p-5 shadow-xl relative overflow-hidden flex flex-col justify-between transition-all group select-none ${
                            isProductAvailable 
                              ? 'border-white/5 hover:border-orange-500/20' 
                              : 'border-red-500/10 opacity-40 grayscale'
                          }`}
                        >
                          <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-full blur-2xl pointer-events-none" />
                          
                          {!isProductAvailable && (
                            <div className="absolute top-3 right-3 z-10 bg-red-600/15 border border-red-500/30 text-red-500 font-black uppercase text-[7px] tracking-widest px-2 py-0.5 rounded">
                              {isOutOfStock ? 'Sold Out' : 'Unavailable'}
                            </div>
                          )}

                          <div className="space-y-2">
                            {/* Head Tags */}
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-[7.5px] font-black uppercase tracking-widest bg-orange-600/10 text-orange-400 px-2 py-0.5 rounded border border-orange-500/20 inline-block">
                                {item.category}
                              </span>
                              
                              {/* Spicy Level Indicator */}
                              {item.spicyLevel !== undefined && item.spicyLevel > 0 && (
                                <span className="text-[7.5px] font-mono text-red-500 uppercase font-black tracking-widest">
                                  {'🔥'.repeat(item.spicyLevel)} SPICY
                                </span>
                              )}
                            </div>
 
                            {/* Title & Desc */}
                            <div>
                              <h4 className="text-sm font-black uppercase tracking-wide text-white group-hover:text-orange-500 transition-colors">
                                {item.name}
                              </h4>
                              <p className="text-[10px] text-gray-400 leading-relaxed font-medium mt-1">
                                {item.description}
                              </p>
                            </div>
 
                            {/* Custom Tag Chips */}
                            <div className="flex flex-wrap gap-1 pt-1">
                              {item.tags.map(tag => (
                                <span key={tag} className="text-[7.5px] font-bold text-gray-500 border border-white/5 bg-white/[0.01] px-1.5 py-0.5 rounded-md">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
 
                          {/* Footer: Price & Adjustments */}
                          <div className="flex items-center justify-between pt-4 border-t border-white/[0.04] mt-4">
                            <span className="text-sm font-mono font-black text-orange-500">
                              {(() => {
                                const specRes = getSpecialDiscount(item.name, item.price, true);
                                if (specRes.hasSpecial) {
                                  return (
                                    <div className="flex flex-col gap-0.5">
                                      <div className="flex items-center gap-1.5 justify-start">
                                        <span className="text-[10px] line-through text-gray-500 font-mono leading-none">
                                          ${item.price.toFixed(2)}
                                        </span>
                                        <span className="text-sm font-mono font-black text-pink-500 leading-none">
                                          ${specRes.discountedPrice.toFixed(2)}
                                        </span>
                                      </div>
                                      <span className="text-[6.5px] bg-pink-500/10 text-pink-400 font-black border border-pink-500/10 px-1 py-0.5 rounded uppercase tracking-wider self-start leading-none mt-1">
                                        {specRes.specialPeriod} Special 🎉
                                      </span>
                                    </div>
                                  );
                                }
                                return `$${item.price.toFixed(2)}`;
                              })()}
                            </span>
                            
                            <div className="flex items-center gap-2">
                              {!isProductAvailable ? (
                                <span className="text-[8px] font-black uppercase text-red-500/70 border border-red-500/15 bg-red-500/5 px-2.5 py-1 rounded-lg font-mono">
                                  {isOutOfStock ? 'Sold Out 🚫' : 'Not Serving'}
                                </span>
                              ) : cartQty > 0 ? (
                                <div className="flex items-center gap-3.5 bg-black/40 border border-white/5 rounded-xl px-2.5 py-1">
                                  <button
                                    onClick={() => handleUpdateCartQuantity(item.id, -1)}
                                    className="text-gray-400 hover:text-white transition-all cursor-pointer p-0.5"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <span className="text-[10px] font-black font-mono text-white min-w-4 text-center">{cartQty}</span>
                                  <button
                                    onClick={() => handleUpdateCartQuantity(item.id, 1)}
                                    className="text-gray-400 hover:text-white transition-all cursor-pointer p-0.5"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleUpdateCartQuantity(item.id, 1)}
                                  className="px-3.5 py-1.5 bg-white/5 hover:bg-orange-600 border border-white/5 hover:border-orange-500/30 text-gray-300 hover:text-white text-[9px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow"
                                >
                                  Add to plate
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Alternative suggestions section */}
                          {!isProductAvailable && foodAlts.length > 0 && (
                            <div className="mt-4 pt-3 border-t border-white/[0.03] space-y-1.5 font-sans">
                              <div className="flex items-center gap-1">
                                <span className="text-[7.5px] font-black uppercase text-gray-500 tracking-wider">Alternative choices:</span>
                                <span className="bg-green-500/10 border border-green-500/20 text-green-400 text-[6px] font-black uppercase tracking-widest px-1 py-0.2 rounded font-mono">
                                  In Stock
                                </span>
                              </div>
                              <div className="flex flex-col gap-1.5">
                                {foodAlts.map(alt => (
                                  <div key={alt.id} className="flex items-center justify-between gap-2 bg-black/40 border border-white/[0.02] p-2 rounded-xl">
                                    <span className="text-[9.5px] font-bold text-gray-300 truncate">{alt.name}</span>
                                    <button
                                      onClick={() => handleUpdateCartQuantity(alt.id, 1)}
                                      className="px-2.5 py-1 bg-white/5 hover:bg-orange-500 hover:border-orange-500 text-gray-300 hover:text-white text-[8px] font-black uppercase tracking-wider rounded-lg border border-white/5 transition-all cursor-pointer shadow-sm shrink-0 font-sans"
                                    >
                                      Add • ${alt.price.toFixed(2)}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Right Side: Kitchen Ticket Order Desk (5 Columns) */}
              <div className="lg:col-span-5 space-y-6">
                {/* Physical Ticket Simulation Container */}
                <div className="bg-[#121212]/30 border border-white/5 rounded-[2.5rem] p-1 shadow-2xl overflow-hidden backdrop-blur-xl relative">
                  <div className="bg-[#fcfaee] text-[#111] font-mono rounded-[2rem] p-6 shadow-inner text-[10.5px] leading-relaxed relative overflow-hidden">
                    {/* Retro ticket design elements */}
                    <div className="absolute top-0 inset-x-0 h-1.5 bg-[radial-gradient(circle_at_center,#111_1px,transparent_1px)] bg-[length:6px_6px] opacity-10" />
                    
                    {/* Barcode & Header */}
                    <div className="text-center space-y-1 mb-4 border-b border-[#222]/10 pb-4">
                      <div className="text-[11px] font-black tracking-widest uppercase">*** SMOKEHOUSE TICKET ***</div>
                      <div className="text-[8px] opacity-50 font-black">STATION: PIT-MASTER OVEN</div>
                      <div className="text-[8px] opacity-50 font-mono">ID: {Math.floor(Date.now() / 1000).toString().substring(4)}</div>
                      <div className="pt-2 font-mono text-[11px] tracking-tight leading-none text-gray-800">
                        ||||||| | |||| | ||||||| | |||
                      </div>
                    </div>

                    <div className="space-y-1.5 border-b border-[#222]/10 pb-3">
                      <div className="flex justify-between items-center font-bold">
                        <span>GUEST NAME:</span>
                        <input
                          type="text"
                          value={profile.name}
                          onChange={e => updateProfile({ name: e.target.value || 'Anonymous' })}
                          className="w-28 bg-[#fcfaee]/40 border-b border-[#222]/20 text-[#111] font-mono p-0 text-right text-[10.5px] outline-none focus:border-[#222] font-black"
                        />
                      </div>
                      <div className="flex justify-between items-center text-[10.5px]">
                        <span className="font-bold">TABLE NUMBER:</span>
                        <input
                          type="text"
                          maxLength={10}
                          value={profile.tableNumber || 't1'}
                          onChange={e => updateProfile({ tableNumber: e.target.value })}
                          placeholder="e.g. t1"
                          className="w-16 bg-[#fcfaee]/40 border-b border-[#222]/20 text-[#111] font-mono p-0 text-right font-black uppercase outline-none focus:border-[#222]"
                        />
                      </div>
                      <div className="flex justify-between items-center text-[10.5px]">
                        <span className="font-bold">SEAT NUMBER:</span>
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={profile.seatNumber || '1'}
                          onChange={e => updateProfile({ seatNumber: e.target.value })}
                          placeholder="e.g. 1"
                          className="w-16 bg-[#fcfaee]/40 border-b border-[#222]/20 text-[#111] font-mono p-0 text-right font-black outline-none focus:border-[#222]"
                        />
                      </div>
                      <div className="flex justify-between text-[9px] text-[#111]/70 font-bold mt-1">
                        <span>DATE: 2026-05-23</span>
                        <span>TIME: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>

                    {/* Cart Items Area */}
                    <div className="border-t border-dashed border-[#222]/20 my-4 pt-3 space-y-2 min-h-24">
                      {Object.keys(foodCart).length === 0 ? (
                        <div className="text-center py-6 text-[#111]/40 text-[9.5px] font-extrabold uppercase italic">
                          Plate is clear. Add items to compile a kitchen dispatch!
                        </div>
                      ) : (
                        Object.entries(foodCart).map(([id, qty]) => {
                          const match = FOOD_MENU.find(f => f.id === id);
                          if (!match) return null;
                          return (
                            <div key={id} className="flex justify-between items-start">
                              <div className="max-w-[75%]">
                                <span className="font-bold">{match.name}</span>
                                <span className="text-[9.5px] block text-black/60">Unit Price: ${match.price.toFixed(2)}</span>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="font-black">x{qty}</span>
                                <span className="block font-bold mt-0.5">${(match.price * qty).toFixed(2)}</span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Notes block */}
                    {Object.keys(foodCart).length > 0 && (
                      <div className="border-t border-[#222]/10 pt-3 space-y-1">
                        <span className="text-[8px] font-black text-black/55 uppercase">Sizzling kitchen comments:</span>
                        <input
                          type="text"
                          value={foodOrderNotes}
                          onChange={e => setFoodOrderNotes(e.target.value)}
                          placeholder="e.g. Ranch extra, wings hot, slider medium rare..."
                          className="w-full bg-[#eee] border border-black/10 rounded-lg p-1.5 text-[10px] text-black placeholder-black/35 focus:outline-none focus:border-[#222] font-mono leading-none"
                        />
                      </div>
                    )}

                    {/* Bill calculations block */}
                    {(() => {
                      const computedSubtotal = Object.entries(foodCart).reduce((acc, [id, qty]) => {
                        const match = FOOD_MENU.find(f => f.id === id);
                        if (!match) return acc;
                        const finalPrice = getSpecialDiscount(match.name, match.price, true).discountedPrice;
                        return acc + finalPrice * qty;
                      }, 0);
                      const computedTax = computedSubtotal * 0.085;
                      const computedTotal = computedSubtotal * 1.085;
                      return (
                        <div className="border-t border-dashed border-[#222]/20 my-4 pt-4 space-y-1 text-right font-mono text-[10px]">
                          <div className="flex justify-between">
                            <span className="opacity-75">SUBTOTAL:</span>
                            <span className="font-bold">${computedSubtotal.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-[9px] opacity-75">
                            <span>EST STATE TAX (8.5%):</span>
                            <span>${computedTax.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-[11px] font-black border-t border-[#222]/10 pt-1.5 mt-1">
                            <span>GRAND ESTIMATED TOTAL:</span>
                            <span className="text-orange-700">${computedTotal.toFixed(2)}</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Action buttons inside paper ticket */}
                    <div className="space-y-1.5 pt-2">
                      <button
                        onClick={handlePlaceFoodOrder}
                        disabled={Object.keys(foodCart).length === 0}
                        className="w-full py-3 bg-[#111] hover:bg-orange-700 text-white hover:text-white rounded-xl text-[9px] font-black uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Utensils className="w-3.5 h-3.5" />
                        Mobilize Smokehouse Kitchen
                      </button>
                      
                      {Object.keys(foodCart).length > 0 && (
                        <button
                          onClick={handleClearCart}
                          className="w-full py-1.5 border border-[#111]/15 hover:bg-red-550/10 text-red-650 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all cursor-pointer"
                        >
                          Clear Platter Cart
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sizzling Active Logs Timeline (Historic Orders) */}
                {foodOrders.length > 0 && (
                  <div className="bg-[#0c0c0c]/95 border border-white/5 rounded-[2.5rem] p-6 shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-24 h-24 bg-orange-600/5 rounded-full blur-xl pointer-events-none" />
                    
                    <div className="flex items-center justify-between border-b border-white/[0.04] pb-3 mb-4">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-white">Guest Smokehouse Log</h4>
                      </div>
                      <span className="text-[8px] font-mono text-gray-500 font-extrabold uppercase">Live status tracker</span>
                    </div>

                    <div className="space-y-4 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                      {foodOrders.map((order, orderIdx) => {
                        return (
                          <div key={order.id} className="p-3 bg-black/40 rounded-2xl border border-white/5 space-y-2 text-xs">
                            <div className="flex items-center justify-between md:flex-row flex-col gap-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[8.5px] font-mono font-black text-gray-500">ORDER NO: {order.id.split('-')[2]}</span>
                                {order.table && (
                                  <span className="text-[7.5px] font-black uppercase text-blue-400 bg-blue-500/5 px-1.5 py-0.2 rounded border border-blue-500/10 font-mono">
                                    Tab: {order.table}
                                  </span>
                                )}
                                {order.seat && (
                                  <span className="text-[7.5px] font-black uppercase text-purple-400 bg-purple-500/5 px-1.5 py-0.2 rounded border border-purple-500/10 font-mono">
                                    Seat: {order.seat}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setViewingQrTicketOrder({
                                    id: order.id,
                                    type: 'food',
                                    itemName: order.items.map(i => `${i.name} x${i.quantity}`).join(', '),
                                    table: order.table || 't1',
                                    seat: order.seat || '1',
                                    guestName: profile.name,
                                    price: order.total,
                                    notes: order.notes
                                  })}
                                  className="p-1 px-2.5 bg-orange-600/15 border border-orange-500/20 rounded-lg text-orange-400 hover:text-white hover:bg-orange-600 transition-all text-[8.5px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                                  title="View QR Dispatch Ticket for bartender to scan"
                                >
                                  <QrCode className="w-3 h-3" />
                                  Ticket QR
                                </button>

                                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                                  order.status === 'Served' 
                                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                    : order.status === 'Plating'
                                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse'
                                    : 'bg-orange-500/10 text-orange-400 border border-orange-500/20 animate-pulse'
                                }`}>
                                  {order.status === 'Served' ? '🥗 SERVED' : `🔥 ${order.status.toUpperCase()}`}
                                </span>
                              </div>
                            </div>

                            {/* Ordered meals content */}
                            <div className="text-[9.5px] font-bold text-gray-300">
                              {order.items.map(i => `${i.name} x${i.quantity}`).join(', ')}
                            </div>

                            {/* Progress bar visual stepper */}
                            <div className="flex items-center justify-between text-[7px] font-black uppercase text-gray-500 pt-1">
                              <span className={order.status === 'Received' || order.status === 'In the Smoker' || order.status === 'Plating' || order.status === 'Served' ? 'text-orange-500' : ''}>1. RECEIVED</span>
                              <span className="opacity-20">➔</span>
                              <span className={order.status === 'In the Smoker' || order.status === 'Plating' || order.status === 'Served' ? 'text-orange-400' : ''}>2. SMOKING</span>
                              <span className="opacity-20">➔</span>
                              <span className={order.status === 'Plating' || order.status === 'Served' ? 'text-orange-400' : ''}>3. PLATING</span>
                              <span className="opacity-20">➔</span>
                              <span className={order.status === 'Served' ? 'text-green-400' : ''}>4. SERVED</span>
                            </div>

                            {/* Interactive progress track overlay bar */}
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                              <div 
                                className={`h-full transition-all duration-1000 ${order.status === 'Served' ? 'bg-green-500' : 'bg-orange-500'}`} 
                                style={{
                                  width: order.status === 'Received' 
                                    ? '15%' 
                                    : order.status === 'In the Smoker' 
                                    ? '50%' 
                                    : order.status === 'Plating' 
                                    ? '82%' 
                                    : '100%'
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ) : patronSubTab === 'profile' ? (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
            >
              {/* Profile Setup: Left Side (5 columns) */}
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-[#0c0c0c]/90 border border-white/5 rounded-[2.5rem] p-6 lg:p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl">
                  <div className="absolute top-0 left-0 w-24 h-24 bg-orange-600/5 rounded-full blur-xl pointer-events-none" />
                  
                  <div className="flex items-center gap-3 border-b border-white/[0.04] pb-5 mb-6">
                    <div className="w-10 h-10 bg-orange-600/10 rounded-xl border border-orange-500/20 flex items-center justify-center text-orange-500">
                      <User className="w-5 h-5 text-orange-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black uppercase tracking-widest italic leading-none font-sans">Lounge Passport</h2>
                      <p className="text-[9px] font-bold text-gray-500 uppercase tracking-tighter mt-1">Cloud Sync, Bookmarks & Location Radar</p>
                    </div>
                  </div>

                  {/* 1. Member Cloud Sync Hub */}
                  <div className="bg-gradient-to-br from-[#121212] to-[#181818] border border-white/[0.04] rounded-3xl p-5 mb-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <h4 className="text-[11px] font-black uppercase text-orange-400 tracking-widest">LOYALTY CLOUD ARCHIVE</h4>
                      </div>
                      {activePatronUser ? (
                        <span className="bg-green-500/10 border border-green-500/20 text-green-400 px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-wider font-mono">
                          ● CLOUD ACTIVE
                        </span>
                      ) : (
                        <span className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-wider font-mono">
                          OFFLINE GUEST
                        </span>
                      )}
                    </div>

                    {activePatronUser ? (
                      <div className="space-y-3">
                        <div className="bg-black/30 border border-white/[0.02] p-3 rounded-2xl">
                          <p className="text-[9px] font-black text-gray-500">PASSPORT USERNAME</p>
                          <p className="text-sm font-black text-white uppercase italic mt-0.5 tracking-wider">
                            {activePatronUser.name}
                          </p>
                          <p className="text-[8px] text-gray-550 font-bold uppercase font-mono mt-1 leading-none">
                            SAVED PORTAL: {activePatronUser.authProvider.toUpperCase()} / AUTH ID: {activePatronUser.id}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={handleSignOutPatron}
                            className="w-full flex items-center justify-center gap-2 bg-red-950/25 border border-red-900/30 hover:bg-red-500 text-red-400 hover:text-white px-3 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            Disconnect Account
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-[9.5px] text-gray-400 font-medium leading-relaxed">
                          Secure your bookmarked recipes, rating logs, and table tabs across all devices using our secure cloud login.
                        </p>

                        {/* Passcode PIN Login/Register */}
                        <div className="bg-black/40 border border-white/5 p-4 rounded-2xl space-y-3 font-sans">
                          <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
                            <span className="text-[9px] font-black uppercase tracking-wider text-orange-400">
                              {registerMode ? "CREATE PASSPORT CODENAME" : "LOUNGE KEY CARD login"}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setRegisterMode(!registerMode);
                                setAuthError(null);
                              }}
                              className="text-[9px] font-black uppercase tracking-widest text-gray-450 hover:text-orange-500 transition-all font-mono"
                            >
                              {registerMode ? "← Back to Login" : "Or Register IPIN →"}
                            </button>
                          </div>

                          <div className="space-y-2">
                            <label className="text-[8.5px] font-black uppercase tracking-widest text-gray-500 block">Lounge Codename</label>
                            <input
                              type="text"
                              value={loginUsername}
                              onChange={e => setLoginUsername(e.target.value)}
                              placeholder="e.g. RhianHart"
                              className="w-full bg-[#121212] border border-white/5 rounded-xl p-2.5 text-xs font-bold text-white placeholder-gray-700 outline-none focus:border-orange-500 transition-all font-sans"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-[8.5px] font-black uppercase tracking-widest text-gray-500 block">4-Digit Security PIN</label>
                            <input
                              type="password"
                              maxLength={4}
                              value={loginPin}
                              onChange={e => setLoginPin(e.target.value.replace(/\D/g, ''))}
                              placeholder="e.g. 1957"
                              className="w-full bg-[#121212] border border-white/5 rounded-xl p-2.5 text-xs text-center font-bold tracking-widest text-white placeholder-gray-700 outline-none focus:border-orange-500 transition-all font-mono"
                            />
                          </div>

                          {authError && (
                            <p className="text-[8.5px] font-bold text-red-400 uppercase text-center mt-1">
                              ⚠ {authError}
                            </p>
                          )}

                          <button
                            type="button"
                            disabled={isSyncProcessing || !loginUsername || loginPin.length < 4}
                            onClick={() => handleCloudLogin(loginUsername, 'pin', loginUsername)}
                            className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md"
                          >
                            {isSyncProcessing ? "Accessing Cloud Secure..." : (registerMode ? "Register Lounge Account" : "Connect Passport Credentials")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. Geotag / Radar Location Simulator Panel */}
                  <div className="bg-gradient-to-br from-[#121212] to-[#181818] border border-white/[0.04] rounded-3xl p-5 mb-6 space-y-4">
                    <div className="flex items-center justify-between border-b border-white/[0.04] pb-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-orange-500 animate-pulse" />
                        <h4 className="text-[11px] font-black uppercase text-orange-400 tracking-widest">LOUNGE GEOTAG SAT-RADAR</h4>
                      </div>
                      <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black tracking-widest uppercase border font-mono ${
                        locationPermissionState === 'granted' 
                          ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                          : 'bg-gray-500/10 border-white/5 text-gray-500'
                      }`}>
                        {locationPermissionState === 'granted' ? 'LOCK ACTIVE' : 'ACQUIRING'}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {nearestEstablishment ? (
                        <div className="bg-black/35 border border-white/[0.02] p-3.5 rounded-2xl space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest leading-none">Nearest Outlet Outlet</p>
                              <h5 className="text-[11px] font-black uppercase text-white tracking-widest mt-1.5">{nearestEstablishment.name}</h5>
                              <p className="text-[8px] text-gray-550 lowercase font-mono leading-none mt-1">{nearestEstablishment.address}</p>
                            </div>
                            <span className="shrink-0 text-right font-mono text-[9.5px] font-black text-orange-500 leading-none">
                              {(nearestEstablishment.distanceMetres / 1000).toFixed(2)} km
                            </span>
                          </div>

                          <div className="pt-2 border-t border-white/[0.03] flex items-center justify-between">
                            <span className="text-[8px] font-black text-green-400 uppercase flex items-center gap-1">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-ping" />
                              Synced App Active
                            </span>
                            <span className="text-[7.5px] font-black uppercase text-gray-500">
                              Proximity geofenced
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-black/20 border border-white/5 p-3 rounded-xl text-center">
                          <p className="text-[9px] text-gray-500 uppercase font-black italic">Waiting for GPS coordinates lock...</p>
                        </div>
                      )}

                      {/* GPS LOCATION SIMULATION HUD - Super professional to demo! */}
                      <div className="bg-black/45 border border-white/5 p-4 rounded-2xl space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">Test Proximity Geofencing (Popups):</span>
                          {simulatedLocationId && (
                            <span className="text-[7.5px] font-black text-orange-500 uppercase font-mono animate-pulse">
                              SIMULATING
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => handleSimulateLocation('bismarck')}
                            className={`p-2 rounded-xl text-[8.5px] font-black uppercase transition-all tracking-wider text-center flex flex-col justify-center items-center gap-1 cursor-pointer ${
                              simulatedLocationId === 'bismarck'
                                ? 'bg-orange-600 text-white shadow-sm'
                                : 'bg-white/5 hover:bg-white/10 text-gray-300'
                            }`}
                          >
                            <span>Bismarck Lounge</span>
                            <span className="text-[6.5px] font-mono text-gray-500 group-hover:text-white mt-0.2">In Range (10m)</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSimulateLocation('west_fargo')}
                            className={`p-2 rounded-xl text-[8.5px] font-black uppercase transition-all tracking-wider text-center flex flex-col justify-center items-center gap-1 cursor-pointer ${
                              simulatedLocationId === 'west_fargo'
                                ? 'bg-orange-600 text-white shadow-sm'
                                : 'bg-white/5 hover:bg-white/10 text-gray-300'
                            }`}
                          >
                            <span>West Fargo Hub</span>
                            <span className="text-[6.5px] font-mono text-gray-500 group-hover:text-white mt-0.2">In Range (250m)</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSimulateLocation('fargo_hq')}
                            className={`p-2 rounded-xl text-[8.5px] font-black uppercase transition-all tracking-wider text-center flex flex-col justify-center items-center gap-1 cursor-pointer ${
                              simulatedLocationId === 'fargo_hq'
                                ? 'bg-orange-600 text-white shadow-sm'
                                : 'bg-white/5 hover:bg-white/10 text-gray-300'
                            }`}
                          >
                            <span>Fargo HQ</span>
                            <span className="text-[6.5px] font-mono text-gray-500 group-hover:text-white mt-0.2">In Range (1.2km)</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSimulateLocation(null)}
                            className={`p-2 rounded-xl text-[8.5px] font-black uppercase transition-all tracking-wider text-center flex flex-col justify-center items-center gap-1 cursor-pointer ${
                              !simulatedLocationId
                                ? 'bg-gray-800 text-white shadow-sm'
                                : 'bg-white/5 hover:bg-white/10 text-gray-300'
                            }`}
                          >
                            <span>Out of Bounds</span>
                            <span className="text-[6.5px] font-mono text-gray-500 group-hover:text-white mt-0.2">Reset (Clear GPS)</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Profile Form */}
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block ml-1">Lounge Badge Name</label>
                      <input
                        type="text"
                        value={profile.name}
                        onChange={e => updateProfile({ name: e.target.value || 'Anonymous Guest' })}
                        placeholder="e.g. James R."
                        className="w-full bg-black/40 border border-white/5 rounded-2xl p-3 text-sm font-bold text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-all font-sans"
                      />
                      <p className="text-[8px] text-gray-600 font-bold uppercase ml-1">Used to tag mixed drinks & transmit live bartender reviews!</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block ml-1">Preferred Flavor Profile</label>
                      <select
                        value={profile.flavorPreference}
                        onChange={e => updateProfile({ flavorPreference: e.target.value })}
                        className="w-full bg-[#121212] border border-white/5 rounded-2xl p-3 text-sm font-bold text-white focus:border-orange-500 outline-none transition-all font-sans"
                      >
                        <option value="All Flavors">All Flavors (Eclectic)</option>
                        <option value="Sweet & Fruity">Sweet & Fruity</option>
                        <option value="Sour & Citrusy">Sour & Citrusy</option>
                        <option value="Smoky & Bold">Smoky & Bold</option>
                        <option value="Bitter & Spirit-Forward">Bitter & Spirit-Forward</option>
                        <option value="Crisp & Refreshing">Crisp & Refreshing</option>
                        <option value="Zero-Proof Clean">Zero-Proof / Mocktails</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block ml-1">Table Number</label>
                        <input
                          type="text"
                          maxLength={10}
                          value={profile.tableNumber || 't1'}
                          onChange={e => updateProfile({ tableNumber: e.target.value })}
                          placeholder="e.g. t1"
                          className="w-full bg-black/40 border border-white/5 rounded-2xl p-3 text-sm font-bold text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-all font-mono uppercase"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block ml-1">Seat Number</label>
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={profile.seatNumber || '1'}
                          onChange={e => updateProfile({ seatNumber: e.target.value })}
                          placeholder="e.g. 1"
                          className="w-full bg-black/40 border border-white/5 rounded-2xl p-3 text-sm font-bold text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-all font-sans"
                        />
                      </div>
                    </div>

                    <div className="bg-black/30 border border-white/[0.03] rounded-2xl p-4 space-y-3">
                      <h4 className="text-[9px] font-black uppercase text-orange-400 tracking-widest">Tasting Statistics</h4>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/[0.03] flex flex-col justify-between">
                          <span className="text-[7.5px] font-black text-gray-500 uppercase tracking-widest leading-none">Bookmarks</span>
                          <span className="text-lg font-black text-white italic font-mono block mt-1">{profile.savedRecipeIds.length}</span>
                        </div>
                        <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/[0.03] flex flex-col justify-between">
                          <span className="text-[7.5px] font-black text-gray-500 uppercase tracking-widest leading-none">Reviews</span>
                          <span className="text-lg font-black text-white italic font-mono block mt-1">{Object.keys(profile.ratings).length}</span>
                        </div>
                        <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/[0.03] flex flex-col justify-between">
                          <span className="text-[7.5px] font-black text-gray-500 uppercase tracking-widest leading-none">Requested</span>
                          <span className="text-lg font-black text-white italic font-mono block mt-1">{(profile.orders || []).length}</span>
                        </div>
                      </div>
                    </div>

                    {/* Active Lounge Session Tab */}
                    <div className="bg-black/40 border border-[#ea580c]/10 rounded-[2rem] p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-white/[0.04] pb-3">
                        <div className="flex items-center gap-2">
                          <Wine className="w-4 h-4 text-orange-500 animate-pulse" />
                          <h4 className="text-[11px] font-black uppercase text-orange-400 tracking-widest">My Lounge Tab</h4>
                        </div>
                        {profile.orders && profile.orders.length > 0 && (
                          <div className="bg-orange-500/10 border border-orange-500/25 text-orange-400 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest font-mono">
                            Tab Total: ${profile.orders.reduce((sum, ord) => sum + ord.price, 0).toFixed(2)}
                          </div>
                        )}
                      </div>

                      {(!profile.orders || profile.orders.length === 0) ? (
                        <p className="text-[9px] text-gray-500 font-bold uppercase text-center py-4 italic">No active requests placed during this session</p>
                      ) : (
                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                          {profile.orders.slice().reverse().map((ord) => (
                            <div key={ord.id} className="bg-black/35 border border-white/[0.03] p-3 rounded-2xl flex items-center justify-between gap-4">
                              <div className="overflow-hidden">
                                <h5 className="text-[11px] font-black uppercase text-white tracking-widest truncate">{ord.recipeName}</h5>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <span className="text-[8px] font-bold text-gray-500 font-mono">{ord.timestamp}</span>
                                  <span className="text-[8px] font-bold text-orange-500/80 font-mono">${ord.price.toFixed(2)}</span>
                                  {ord.table && (
                                    <span className="text-[7.5px] font-black uppercase text-blue-400 bg-blue-500/5 px-1 py-0.2 rounded border border-blue-500/10 font-mono">
                                      Tab: {ord.table}
                                    </span>
                                  )}
                                  {ord.seat && (
                                    <span className="text-[7.5px] font-black uppercase text-purple-400 bg-purple-500/5 px-1 py-0.2 rounded border border-purple-500/10 font-mono">
                                      Seat: {ord.seat}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setViewingQrTicketOrder({
                                    id: ord.id,
                                    type: 'cocktail',
                                    itemName: ord.recipeName,
                                    table: ord.table || 't1',
                                    seat: ord.seat || '1',
                                    guestName: profile.name,
                                    price: ord.price,
                                    notes: (recipes.find(r => r.id === ord.recipeId)?.instructions || '')
                                  })}
                                  className="p-1 px-2 bg-orange-600/15 border border-orange-500/20 rounded-lg text-orange-400 hover:text-white hover:bg-orange-600 transition-all text-[8.5px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                                  title="View QR Dispatch Ticket for bartender to scan"
                                >
                                  <QrCode className="w-3 h-3" />
                                  Ticket QR
                                </button>

                                <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black tracking-widest uppercase border font-mono ${
                                  ord.status === 'Ready' || ord.status === 'Served'
                                    ? 'bg-green-500/10 border-green-500/20 text-green-400'
                                    : 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                                }`}>
                                  {ord.status}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      <p className="text-[8px] text-gray-500 uppercase text-center leading-normal max-w-xs mx-auto">
                        🛎️ State badge name <span className="text-orange-400 font-black">"{profile.name}"</span> at the bar register counter to compile, compile custom recipes, checkout or pay.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Saved Drinks & Feedback Log timeline: Right Side (7 columns) */}
              <div className="lg:col-span-7 space-y-6">
                {/* Section 1: Bookmarks */}
                <div className="bg-[#0c0c0c]/90 border border-white/5 rounded-[2.5rem] p-6 lg:p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl">
                  <h3 className="text-sm font-black uppercase tracking-widest text-shadow-sm mb-4 flex items-center gap-2">
                    <Heart className="w-4 h-4 text-red-500 fill-current" />
                    My Bookmarked Recipes
                  </h3>

                  {profile.savedRecipeIds.length === 0 ? (
                    <div className="py-8 text-center text-gray-500 text-xs bg-black/20 border border-dashed border-white/5 rounded-2xl">
                      <p className="font-semibold uppercase tracking-tight">No bookmarks saved yet</p>
                      <p className="text-[10px] text-gray-600 mt-1">Tap the heart icon on any drinks menu item to bookmark it here!</p>
                      <button
                        onClick={() => setPatronSubTab('menu')}
                        className="mt-4 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-[8px] font-black uppercase tracking-widest text-white rounded-lg transition-all cursor-pointer"
                      >
                        Explore Cocktails Menu
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {recipes
                        .filter(r => profile.savedRecipeIds.includes(r.id))
                        .map(r => {
                          const isDrinkInStock = getRecipeAvailability(r).allAvailable;
                          return (
                            <div key={r.id} className="bg-black/30 border border-white/[0.04] p-4 rounded-3xl flex items-center justify-between gap-3 group hover:border-orange-500/10 transition-all">
                              <div className="overflow-hidden">
                                <span className="text-[7px] font-black uppercase text-orange-500 tracking-widest block mb-0.5">{r.category}</span>
                                <h4 className="font-black text-white text-sm uppercase italic truncate">{r.name}</h4>
                                <span className={`text-[8px] font-bold block mt-1 ${isDrinkInStock ? 'text-green-500' : 'text-gray-500'}`}>
                                  {isDrinkInStock ? '✓ Ready to Order' : '× Out of Stock'}
                                </span>
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  onClick={() => setOrderingRecipe(r)}
                                  disabled={!isDrinkInStock}
                                  className={`px-2.5 py-1.5 rounded-xl transition-all text-[8px] font-black uppercase cursor-pointer ${
                                    isDrinkInStock 
                                      ? 'bg-orange-600 hover:bg-orange-500 text-white shadow-sm' 
                                      : 'bg-white/5 text-gray-600 border border-white/5 cursor-not-allowed'
                                  }`}
                                  title={isDrinkInStock ? 'Request Counter Pour' : 'Ingredients Out of Stock'}
                                >
                                  Pour
                                </button>
                                <button
                                  onClick={() => {
                                    setSearchQuery(r.name);
                                    setSelectedCategory('All');
                                    setOnlySaved(false);
                                    setPatronSubTab('menu');
                                  }}
                                  className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-xl text-gray-300 hover:text-white transition-all text-[8px] font-black uppercase cursor-pointer"
                                  title="View Recipe details"
                                >
                                  View
                                </button>
                                <button
                                  onClick={() => handleToggleSaveRecipe(r.id)}
                                  className="p-2 bg-red-950/20 hover:bg-red-500 border border-red-900/30 hover:border-red-500 rounded-xl text-red-400 hover:text-white transition-all cursor-pointer flex items-center justify-center animate-none"
                                  title="Unsave recipe"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>

                {/* Section 2: Feedback Log Timeline */}
                <div className="bg-[#0c0c0c]/90 border border-white/5 rounded-[2.5rem] p-6 lg:p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl">
                  <h3 className="text-sm font-black uppercase tracking-widest text-shadow-sm mb-4 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-orange-500" />
                    My Drink Feedback Timeline
                  </h3>

                  {/* Interactive Direct Feedback Form */}
                  <div className="mb-6 p-5 bg-white/[0.01] border border-white/5 rounded-[2rem] space-y-4">
                    <div className="flex items-center justify-between border-b border-white/[0.04] pb-3">
                      <div className="flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5 text-orange-550" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">Leave Drink Experience Rating</span>
                      </div>
                      <span className="text-[8px] font-black font-mono text-gray-500 uppercase tracking-tighter">Live Lounge Portal</span>
                    </div>

                    <form onSubmit={handleProfileDirectRating} className="space-y-4">
                      {profileFeedbackSuccess && (
                        <div className="p-3 bg-green-500/10 border border-green-500/25 text-green-400 text-[10px] font-bold uppercase rounded-xl flex items-center gap-2 animate-pulse">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                          <span>{profileFeedbackSuccess}</span>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Selector for any receipt or menu drink */}
                        <div className="space-y-1.5 flex flex-col justify-end">
                          <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 block ml-0.5">Select Beverage</label>
                          <select
                            value={profileFeedbackDrinkId}
                            onChange={e => setProfileFeedbackDrinkId(e.target.value)}
                            required
                            className="w-full bg-[#121212] border border-white/5 rounded-xl p-2 text-xs font-semibold text-white focus:border-orange-500 outline-none transition-all font-sans"
                          >
                            <option value="">-- Choose Recipe --</option>
                            {recipes.map(r => (
                              <option key={r.id} value={r.id}>
                                {r.name} ({r.category})
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Thumbs Up / Thumbs Down */}
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 block ml-0.5">Drink Feeling</label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setProfileFeedbackLiked(true)}
                              className={`flex-1 py-1.5 rounded-xl border transition-all cursor-pointer flex items-center justify-center gap-1.5 text-[10px] font-black uppercase tracking-wider ${
                                profileFeedbackLiked
                                  ? 'bg-green-500/10 border-green-500/30 text-green-400'
                                  : 'bg-black/40 border-white/5 text-gray-555 hover:text-white'
                              }`}
                            >
                              <ThumbsUp className="w-3.5 h-3.5" />
                              Liked
                            </button>
                            <button
                              type="button"
                              onClick={() => setProfileFeedbackLiked(false)}
                              className={`flex-1 py-1.5 rounded-xl border transition-all cursor-pointer flex items-center justify-center gap-1.5 text-[10px] font-black uppercase tracking-wider ${
                                !profileFeedbackLiked
                                  ? 'bg-red-500/10 border-red-500/30 text-red-500'
                                  : 'bg-black/40 border-white/5 text-gray-555 hover:text-white'
                              }`}
                            >
                              <ThumbsDown className="w-3.5 h-3.5" />
                              Disliked
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Stars Rating Score */}
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 block ml-0.5">Tasting Balance Score</span>
                        <div className="flex items-center gap-2">
                          {[1, 2, 3, 4, 5].map(score => {
                            const isSelected = score <= profileFeedbackRating;
                            return (
                              <button
                                key={score}
                                type="button"
                                onClick={() => setProfileFeedbackRating(score)}
                                className="transition-all hover:scale-125 p-1 cursor-pointer"
                              >
                                <Star 
                                  className={`w-5 h-5 ${
                                    isSelected ? 'text-yellow-400 fill-yellow-400' : 'text-gray-655'
                                  }`} 
                                />
                              </button>
                            );
                          })}
                          <span className="text-[10px] font-mono text-gray-500 uppercase font-black ml-2 mt-0.5">
                            {profileFeedbackRating} / 5 Rating
                          </span>
                        </div>
                      </div>

                      {/* Feature Impression Chips */}
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 block ml-0.5">Select Flavor Notes & Sensation Tag</span>
                        <div className="flex flex-wrap gap-1.5">
                          {['Perfect Mix', 'Strong Pour 🥃', 'Too Sweet 🍬', 'Really Sour 🍋', 'Crisp & Clean ❄️', 'Smoky Note 🔥'].map(tag => {
                            const isSelected = profileFeedbackTags.includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setProfileFeedbackTags(prev => prev.filter(t => t !== tag));
                                  } else {
                                    setProfileFeedbackTags(prev => [...prev, tag]);
                                  }
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all cursor-pointer border ${
                                  isSelected
                                    ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                                    : 'bg-black/35 text-gray-500 border-white/5 hover:text-gray-300'
                                }`}
                              >
                                {tag}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Custom comments */}
                      <div className="space-y-1.5">
                        <textarea
                          placeholder="What did you think of the pour, texture, balance, or temperature? Leave a detailed review..."
                          value={profileFeedbackComment}
                          onChange={e => setProfileFeedbackComment(e.target.value)}
                          rows={2}
                          className="w-full bg-black/50 border border-white/5 rounded-xl p-2.5 text-xs text-white placeholder-gray-655 focus:outline-none focus:border-orange-500 transition-all font-sans resize-none font-medium"
                        />
                      </div>

                      {/* Form action button */}
                      <div className="flex justify-end pt-1">
                        <button
                          type="submit"
                          className="px-4 py-2 bg-gradient-to-r from-orange-600 to-orange-500 hover:brightness-110 text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-[0.98] cursor-pointer"
                        >
                          Submit Drink Review
                        </button>
                      </div>
                    </form>
                  </div>

                  {Object.keys(profile.ratings).length === 0 ? (
                    <div className="py-8 text-center text-gray-500 text-xs bg-black/20 border border-dashed border-white/5 rounded-2xl">
                      <p className="font-semibold uppercase tracking-tight">No feedback left yet</p>
                      <p className="text-[10px] text-gray-600 mt-1">Review drinks directly from the drinks menu to compile a log!</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(profile.ratings).map(([recipeId, rating]) => {
                        const recName = recipes.find(r => r.id === recipeId)?.name || 'Custom Drink / Deleted';
                        const recCat = recipes.find(r => r.id === recipeId)?.category || 'Cocktail';
                        return (
                          <div key={recipeId} className="bg-black/30 border border-white/[0.04] p-4 rounded-3xl space-y-2 relative overflow-hidden group hover:border-orange-500/10 transition-all">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <span className="text-[7px] font-black uppercase text-orange-500 tracking-widest block mb-0.5">{recCat}</span>
                                <h4 className="font-extrabold text-[#f1f1f1] text-xs uppercase italic">{recName}</h4>
                                <span className="text-[8px] font-black text-gray-600 uppercase font-mono tracking-tight block mt-1">{rating.timestamp}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center gap-1 border ${
                                  rating.liked 
                                    ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                                    : 'bg-red-500/10 border-red-500/25 text-red-500 border-red-500/20'
                                }`}>
                                  {rating.liked ? <ThumbsUp className="w-2.5 h-2.5" /> : <ThumbsDown className="w-2.5 h-2.5" />}
                                  {rating.liked ? 'Liked' : 'Disliked'}
                                </span>
                                <button
                                  onClick={() => handleRemoveRating(recipeId)}
                                  className="opacity-40 group-hover:opacity-100 hover:text-red-400 transition-all cursor-pointer p-1"
                                  title="Delete Feedback"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <p className="text-[11px] text-gray-400 italic bg-black/25 p-2 rounded-xl border border-white/[0.02]">
                              "{rating.comment || 'Satisfied selection'}"
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : patronSubTab === 'scan' ? (
            <motion.div
              key="scan"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="max-w-xl mx-auto space-y-6"
            >
              <div className="bg-[#0c0c0c]/90 border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden backdrop-blur-xl space-y-6">
                <div>
                  <h3 className="text-lg font-black text-white uppercase tracking-wider">Table & Seat QR Scanner</h3>
                  <p className="text-xs text-gray-400 mt-1 font-semibold">
                    Scan a Smoke Eaters Table QR code to automatically configure your table number and seat allocation for cocktails and food delivery.
                  </p>
                </div>

                {/* Live Scanner Box */}
                <div className="bg-black/60 border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center relative overflow-hidden min-h-[300px]">
                  {isScanning ? (
                    <div className="w-full space-y-4">
                      {/* Reader Target Div */}
                      <div id="qr-reader" className="w-full max-w-[320px] mx-auto rounded-xl overflow-hidden border border-orange-500/30 shadow-lg bg-black font-mono text-[10px]" />
                      
                      <div className="flex justify-center">
                        <button
                          onClick={() => setIsScanning(false)}
                          className="px-4 py-2 bg-red-600/10 hover:bg-red-600/20 border border-red-500/20 hover:border-red-500/40 text-red-400 text-[10px] font-black uppercase tracking-wider rounded-xl cursor-pointer transition-all font-mono"
                        >
                          Stop Scanner
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center space-y-5 py-6">
                      <div className="w-16 h-16 bg-orange-500/10 rounded-full flex items-center justify-center mx-auto text-orange-500 animate-pulse border border-orange-500/10">
                        <QrCode className="w-8 h-8" />
                      </div>
                      
                      <div className="space-y-1">
                        <p className="text-xs font-black uppercase tracking-wider text-white">Camera ready</p>
                        <p className="text-[10px] text-gray-500 max-w-xs mx-auto font-medium">
                          Tap below to activate your rear camera and scan desk/table setups immediately.
                        </p>
                      </div>

                      <button
                        onClick={() => {
                          setIsScanning(true);
                          setScanError(null);
                        }}
                        className="px-6 py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95 cursor-pointer font-sans"
                      >
                        📷 Launch Camera Scanner
                      </button>
                    </div>
                  )}

                  {scanError && (
                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-200 text-[10px] rounded-xl font-mono text-center max-w-xs">
                      ⚠️ Status: {scanError}
                    </div>
                  )}
                </div>

                {/* Quick Simulation Board */}
                <div className="bg-orange-500/5 border border-orange-500/10 rounded-2xl p-4.5 space-y-3">
                  <span className="text-[9px] font-extrabold text-orange-400 uppercase tracking-widest block font-sans">👋 Simulation Tester (No Camera Needed)</span>
                  <p className="text-[10.5px] text-orange-200/80 leading-relaxed font-semibold">
                    Working on a device without physical camera access? Bypass permissions in sandbox frames by selecting any pre-configured seat allocation simulation below:
                  </p>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    {[
                      { table: 't1', seat: '1' },
                      { table: 't2', seat: '4' },
                      { table: 't5', seat: '2' },
                      { table: 't12', seat: '6' }
                    ].map((sim) => (
                      <button
                        key={`${sim.table}-${sim.seat}`}
                        onClick={() => {
                          updateProfile({ tableNumber: sim.table, seatNumber: sim.seat });
                          addNotification(`Simulated Scan: Checked into Table ${sim.table.toUpperCase()} | Seat ${sim.seat}!`, 'success');
                          setPatronSubTab('menu');
                        }}
                        className="p-2.5 bg-black/40 hover:bg-orange-500/15 border border-white/5 hover:border-orange-500/30 text-white rounded-xl text-center font-mono cursor-pointer transition-all"
                      >
                        <div className="text-[10px] font-bold text-gray-400">TABLE</div>
                        <div className="text-xs font-black text-orange-400 uppercase">{sim.table}</div>
                        <div className="text-[9px] font-semibold text-gray-500 mt-0.5">Seat #{sim.seat}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Manual Table Selection Form */}
                <div className="border-t border-white/5 pt-4 space-y-3">
                  <span className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest block font-sans">Manual Configuration Slot</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1 font-sans">
                      <label className="text-[8.5px] font-bold text-gray-500 uppercase block ml-1">Table Designation</label>
                      <input
                        type="text"
                        maxLength={10}
                        value={profile.tableNumber || 't1'}
                        onChange={(e) => updateProfile({ tableNumber: e.target.value })}
                        className="w-full bg-black/45 border border-white/10 px-3 py-1.5 rounded-xl text-xs font-mono font-bold text-white uppercase outline-none focus:border-orange-500"
                        placeholder="t1"
                      />
                    </div>
                    <div className="space-y-1 font-sans">
                      <label className="text-[8.5px] font-bold text-gray-500 uppercase block ml-1">Seat Number</label>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={profile.seatNumber || '1'}
                        onChange={(e) => updateProfile({ seatNumber: e.target.value })}
                        className="w-full bg-black/45 border border-white/10 px-3 py-1.5 rounded-xl text-xs font-mono font-bold text-white outline-none focus:border-orange-500"
                        placeholder="1"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="bill"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="grid lg:grid-cols-12 gap-8 items-start"
            >
              {/* Itemized Activity Logs (7 columns) */}
              <div className="lg:col-span-7 space-y-6">
                <div className="bg-[#0c0c0c]/90 border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden backdrop-blur-xl space-y-5">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-black text-white uppercase tracking-wider">Active Tab Check</h3>
                      <p className="text-xs text-gray-400 mt-1 font-semibold">
                        Table: <span className="text-orange-500 font-bold uppercase">{profile.tableNumber || 't1'}</span> | Seat: <span className="text-orange-500 font-bold">{profile.seatNumber || '1'}</span>
                      </p>
                    </div>
                    <span className="text-[9px] font-black uppercase bg-green-500/10 border border-green-500/20 text-green-400 px-3 py-1 rounded-full font-mono tracking-widest">
                      Active Bill
                    </span>
                  </div>

                  {/* Drink Requests Section (9% alcohol tax) */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-white/5 pb-2 font-sans">
                      <span className="text-[9px] font-black text-orange-400 uppercase tracking-widest">Alcoholic Drinks (9% tax)</span>
                      <span className="text-[9px] font-bold text-gray-500 font-mono">{(profile.orders || []).length} pours</span>
                    </div>

                    {(profile.orders || []).length === 0 ? (
                      <p className="text-xs text-gray-500 italic py-2 font-mono">No dynamic cocktails selected yet this session.</p>
                    ) : (
                      <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                        {(profile.orders || []).map((ord) => (
                          <div key={ord.id} className="flex justify-between items-center bg-black/40 border border-white/[0.03] p-2.5 rounded-xl hover:border-white/10 transition-all font-mono">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-white uppercase">{ord.recipeName}</span>
                              <span className="text-[8px] text-gray-500 mt-0.5">{ord.timestamp} • Status: {ord.status}</span>
                            </div>
                            <span className="text-xs font-extrabold text-orange-400">${ord.price.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Food Orders Section (7% food tax) */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between border-b border-white/5 pb-2 font-sans">
                      <span className="text-[9px] font-black text-orange-400 uppercase tracking-widest">Kitchen Smoked Food (7% tax)</span>
                      <span className="text-[9px] font-bold text-gray-500 font-mono">{foodOrders.length} orders</span>
                    </div>

                    {foodOrders.length === 0 ? (
                      <p className="text-xs text-gray-500 italic py-2 font-mono">No BBQ foods ordered yet this session.</p>
                    ) : (
                      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                        {foodOrders.map((ord) => (
                          <div key={ord.id} className="bg-black/40 border border-white/[0.03] p-3 rounded-xl space-y-2 hover:border-white/10 transition-all">
                            <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                              <span>Ticket #{ord.id.split('-')[1] || ord.id.slice(-4)}</span>
                              <span>{ord.timestamp}</span>
                            </div>
                            <div className="space-y-1 pl-1">
                              {ord.items.map((it, idx) => (
                                <div key={idx} className="flex justify-between text-xs text-gray-300">
                                  <span>{it.name} <span className="text-[10px] text-gray-500 font-mono">x{it.quantity}</span></span>
                                  <span className="font-mono text-gray-400">${(it.price * it.quantity).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bill Totals Panel & scan code (5 columns) */}
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-[#0c0c0c]/90 border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden backdrop-blur-xl space-y-5">
                  <h3 className="text-xs font-black uppercase text-gray-400 tracking-[0.2em] italic flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-orange-500" />
                    Bill Summary & Payment
                  </h3>

                  {/* Financial Statement Sheet with explicitly mandated tax rates */}
                  <div className="bg-black/40 p-4 rounded-2xl border border-white/5 space-y-3 font-mono text-xs">
                    <div className="flex justify-between items-center text-gray-400">
                      <span>Alcohol subtotal</span>
                      <span>${((profile.orders || []).reduce((sum, o) => sum + o.price, 0)).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10.5px] text-blue-400 bg-blue-500/5 px-2 py-1 rounded">
                      <span>Alcohol tax (9%)</span>
                      <span>${(((profile.orders || []).reduce((sum, o) => sum + o.price, 0)) * 0.09).toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between items-center text-gray-400 pt-1">
                      <span>Food subtotal</span>
                      <span>${(foodOrders.reduce((sum, o) => sum + o.subtotal, 0)).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10.5px] text-purple-400 bg-purple-500/5 px-2 py-1 rounded">
                      <span>Food tax (7%)</span>
                      <span>${((foodOrders.reduce((sum, o) => sum + o.subtotal, 0)) * 0.07).toFixed(2)}</span>
                    </div>

                    <div className="border-t border-white/10 pt-3 flex justify-between items-center font-black text-sm text-white">
                      <span>GRAND TOTAL</span>
                      <span className="text-orange-400">
                        ${(
                          ((profile.orders || []).reduce((sum, o) => sum + o.price, 0)) * 1.09 +
                          (foodOrders.reduce((sum, o) => sum + o.subtotal, 0)) * 1.07
                        ).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Payment Scan Code Card */}
                  <div className="bg-black/60 border border-white/10 p-4 rounded-2xl flex flex-col items-center justify-center space-y-3 text-center">
                    <span className="text-[8.5px] font-black uppercase text-orange-500 tracking-wider">Bartender Charge Code</span>
                    
                    <div className="w-36 h-36 bg-white p-2 rounded-xl flex items-center justify-center shadow-inner overflow-hidden transition-all hover:scale-[1.02]">
                      <img 
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encodeURIComponent(
                          `CHARGE-t:${profile.tableNumber || 't1'}-s:${profile.seatNumber || '1'}-g:${profile.name}-a:${((profile.orders || []).reduce((sum, o) => sum + o.price, 0)).toFixed(2)}-f:${(foodOrders.reduce((sum, o) => sum + o.subtotal, 0)).toFixed(2)}`
                        )}`}
                        alt="Billing QR Code for Bartender scan"
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    </div>

                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">Present to staff</p>
                      <p className="text-[8.5px] text-gray-500 max-w-[200px] leading-tight font-sans font-semibold">
                        Present this synchronized receipt code to your bartender to instantly settle your session check at the workstation.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Dynamic Glass Order Confirmation Overlay */}
      <AnimatePresence>
        {orderingRecipe && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#0b0b0b] border border-orange-500/25 rounded-[2.5rem] max-w-md w-full p-6 lg:p-8 shadow-2xl space-y-6 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-orange-600/10 rounded-full blur-2xl pointer-events-none" />

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center text-orange-500 border border-orange-500/20">
                  <Wine className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <span className="text-[8px] font-black uppercase text-orange-500 tracking-widest">{orderingRecipe.category || 'Cocktail'}</span>
                  <h3 className="text-xl font-black text-white uppercase italic tracking-tight leading-none mt-0.5">{orderingRecipe.name}</h3>
                </div>
              </div>

              {/* Active Substitutions */}
              {Object.keys(activeSubstitutions).length > 0 && (
                <div className="bg-green-500/5 border border-green-500/10 p-4 rounded-2xl space-y-2">
                  <span className="text-[8px] font-black uppercase text-green-400 tracking-wider block font-mono">✓ ACTIVE IN-STOCK SUBSTITUTIONS:</span>
                  <div className="space-y-1.5">
                    {Object.entries(activeSubstitutions).map(([orig, sub]) => (
                      <div key={orig} className="text-[9.5px] font-semibold text-gray-300 flex justify-between items-center bg-black/30 px-2.5 py-1 rounded border border-white/[0.02]">
                        <span className="line-through text-red-400/80">{orig}</span>
                        <span className="text-gray-500 text-[8px] font-bold mx-2">substituted:</span>
                        <span className="text-green-400 font-bold">{sub}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Selected Mixer Option */}
              {selectedMixerForRecipe[orderingRecipe.id] && (
                <div className="bg-purple-500/5 border border-purple-500/15 p-4 rounded-2xl space-y-2 font-sans">
                  <span className="text-[8px] font-black uppercase text-purple-400 tracking-wider block font-mono flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                    ✦ SELECTED MIXER OPTION:
                  </span>
                  <div className="text-[9.5px] font-semibold text-gray-300 flex justify-between items-center bg-purple-950/10 px-2.5 py-1.5 rounded border border-purple-500/10">
                    <span className="text-gray-400">Pour style / mixer</span>
                    <span className="text-purple-300 font-bold uppercase tracking-wider">{selectedMixerForRecipe[orderingRecipe.id]} Included</span>
                  </div>
                </div>
              )}

              {/* Costing Breakdowns Based on Margin */}
              <div className="bg-black/45 border border-white/5 rounded-2xl p-4.5 space-y-3 font-sans text-xs">
                <div className="flex justify-between items-center">
                  <span className="font-black uppercase text-gray-300 text-[10px] tracking-wider">Suggested Price:</span>
                  <span className="font-black text-lg text-orange-500 font-mono italic">
                    ${calculatePriceWithMargin(orderingRecipe).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Table & Seat Selection details */}
              <div className="bg-black/45 border border-white/5 rounded-2xl p-4.5 space-y-3 font-sans text-xs">
                <div className="flex justify-between items-center text-[10px] font-black uppercase text-gray-400">
                  <span>Table & Seat Allocation:</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-gray-500 uppercase tracking-wider block">Table (e.g. t1)</label>
                    <input
                      type="text"
                      maxLength={10}
                      value={profile.tableNumber || 't1'}
                      onChange={e => updateProfile({ tableNumber: e.target.value })}
                      className="w-full bg-black/60 border border-white/10 hover:border-orange-500/30 text-white font-bold px-3 py-1.5 rounded-lg text-xs outline-none focus:border-orange-500 transition-all font-mono uppercase"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-gray-500 uppercase tracking-wider block">Seat Number</label>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={profile.seatNumber || '1'}
                      onChange={e => updateProfile({ seatNumber: e.target.value })}
                      className="w-full bg-black/60 border border-white/10 hover:border-orange-500/30 text-white font-bold px-3 py-1.5 rounded-lg text-xs outline-none focus:border-orange-500 transition-all font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-orange-500/5 border border-orange-500/10 p-3.5 rounded-2xl text-[10px] text-orange-200/90 leading-relaxed font-semibold">
                👋 State badge name <span className="text-white font-black">"{profile.name}"</span> to your bartender. If you want this drink at this customized pricing rate, tap "Request Counter Pour" to submit!
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setOrderingRecipe(null);
                    setActiveSubstitutions({});
                  }}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-2xl text-[10.5px] font-black uppercase tracking-widest transition-all cursor-pointer border border-transparent hover:border-white/5"
                >
                  Go Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const price = calculatePriceWithMargin(orderingRecipe);
                    
                    const isSubbed = Object.keys(activeSubstitutions).length > 0;
                    const chosenMixer = selectedMixerForRecipe[orderingRecipe.id];
                    
                    const finalRecipeName = chosenMixer 
                      ? `${orderingRecipe.name} (with ${chosenMixer})` 
                      : (isSubbed ? `${orderingRecipe.name} (with subs)` : orderingRecipe.name);

                    let finalNotes = isSubbed
                      ? `${orderingRecipe.instructions || 'Standard assembly'} [SUBSTITUTIONS APPLIED: ${Object.entries(activeSubstitutions).map(([orig, sub]) => `${orig}➔${sub}`).join(', ')}]`
                      : (orderingRecipe.instructions || 'Standard assembly');

                    if (chosenMixer) {
                      finalNotes += ` [ADD MIXER: ${chosenMixer}]`;
                    }

                    if (orderingRecipe.barNotes) {
                      finalNotes += ` [BAR PREP NOTES: ${orderingRecipe.barNotes}]`;
                    }

                    // Create order log inside guests profile state
                    const newOrder: PatronOrder = {
                      id: `ord-${Date.now()}`,
                      recipeId: orderingRecipe.id,
                      recipeName: finalRecipeName,
                      price,
                      timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
                      status: 'Preparing',
                      table: profile.tableNumber || 't1',
                      seat: profile.seatNumber || '1'
                    };

                    const updatedOrders = [...(profile.orders || []), newOrder];
                    updateProfile({ orders: updatedOrders });

                    const subSuffix = isSubbed
                      ? ` substituting: ${Object.entries(activeSubstitutions).map(([orig, sub]) => `${orig} with ${sub}`).join(', ')}`
                      : '';
                    const mixerSuffix = chosenMixer ? ` with ${chosenMixer}` : '';

                    // Fire live notifications
                    addNotification(`[Table: ${(profile.tableNumber || 't1').toUpperCase()} | Seat: ${profile.seatNumber || '1'}] Guest "${profile.name}" requested dynamic drink "${orderingRecipe.name}${mixerSuffix}"${subSuffix}! Suggested Lounge Price: $${price.toFixed(2)}`, 'info');

                    setOrderingRecipe(null);
                    setOrderedSuccessDrink(orderingRecipe.name);
                    setViewingQrTicketOrder({
                      id: newOrder.id,
                      type: 'cocktail',
                      itemName: newOrder.recipeName,
                      table: newOrder.table,
                      seat: newOrder.seat,
                      guestName: profile.name,
                      notes: finalNotes,
                      price: newOrder.price
                    });
                    setActiveSubstitutions({});
                  }}
                  className="flex-1 py-3 bg-gradient-to-r from-orange-600 to-orange-550 hover:brightness-110 text-white rounded-2xl text-[10.5px] font-black uppercase tracking-widest transition-all cursor-pointer shadow-lg shadow-orange-500/20"
                >
                  Request Counter Pour
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dynamic Success Toast */}
      <AnimatePresence>
        {orderedSuccessDrink && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 50 }}
            className="fixed bottom-6 right-6 z-50 bg-[#0d0d0d] border border-green-500/30 p-5 rounded-3xl shadow-2xl max-w-sm w-full space-y-3"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-green-500/15 rounded-lg border border-green-500/20 flex items-center justify-center text-green-400 leading-none font-bold">
                ✓
              </div>
              <div>
                <h4 className="text-xs font-black uppercase text-white tracking-widest italic leading-none">Order Sent To Staff!</h4>
                <p className="text-[9px] text-gray-500 font-bold uppercase tracking-tighter mt-1">Status: Preparing (Lounge Queue)</p>
              </div>
            </div>
            <p className="text-[10.5px] text-gray-300 leading-relaxed font-semibold">
              "${orderedSuccessDrink}" is being compiled at our staff display. Walk up to the bar register counter and state badge <span className="text-orange-400 font-extrabold font-sans">"{profile.name}"</span> to order and pay!
            </p>
            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => {
                  setOrderedSuccessDrink(null);
                  setPatronSubTab('profile');
                }}
                className="text-[9px] font-black text-orange-400 hover:text-orange-300 uppercase underline cursor-pointer"
              >
                View Lounge Tab
              </button>
              <button
                onClick={() => setOrderedSuccessDrink(null)}
                className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-white rounded-lg text-[8px] font-black uppercase cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Order Dispatch QR Ticket Overlay Modal */}
      <AnimatePresence>
        {viewingQrTicketOrder && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-[#111111] border border-orange-500/25 rounded-3xl max-w-sm w-full p-6 shadow-2xl relative overflow-hidden text-center space-y-6"
            >
              {/* Top ambient orange blur */}
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-orange-600 via-amber-500 to-orange-600" />
              <div className="absolute top-0 right-0 w-32 h-32 bg-orange-600/10 rounded-full blur-2xl pointer-events-none -mr-8 -mt-8" />
              
              {/* Ticket Icon / Status Header */}
              <div className="space-y-1.5 pt-2">
                <div className="w-12 h-12 bg-orange-600/20 border border-orange-500/30 text-orange-400 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-orange-500/5">
                  <QrCode className="w-6 h-6 animate-pulse" />
                </div>
                <h3 className="text-sm font-black uppercase text-orange-500 tracking-wider">Lounge Order Dispatch Ticket</h3>
                <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest leading-none">Instant Barcode Pass</p>
              </div>

              {/* Ticket Divider Border with Cutouts */}
              <div className="relative border-t border-dashed border-white/10 my-1 py-1">
                <div className="absolute -left-9 top-1/2 -translate-y-1/2 w-6 h-6 bg-[#040404] border-r border-orange-500/10 rounded-full" />
                <div className="absolute -right-9 top-1/2 -translate-y-1/2 w-6 h-6 bg-[#040404] border-l border-orange-500/10 rounded-full" />
              </div>

              {/* Order summary table */}
              <div className="bg-black/60 border border-white/[0.03] p-4 rounded-2xl text-left space-y-3 font-sans">
                <div className="flex justify-between items-start">
                  <div className="space-y-0.5">
                    <span className="text-[8px] text-gray-400 font-mono font-bold uppercase">Item / Request</span>
                    <h4 className="text-xs font-black text-white uppercase tracking-tight line-clamp-2">{viewingQrTicketOrder.itemName}</h4>
                  </div>
                  <div className="text-right">
                    <span className="text-[8px] text-gray-400 font-mono font-bold uppercase block">Est Price</span>
                    <span className="text-xs font-black text-orange-400 font-mono">${(viewingQrTicketOrder.price || 0).toFixed(2)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-white/5 pt-2.5 font-sans">
                  <div>
                    <span className="text-[8px] text-gray-400 font-mono font-bold uppercase block">Lounge Station</span>
                    <span className="text-[10px] font-black text-blue-400 uppercase font-mono">Table {viewingQrTicketOrder.table.toUpperCase()} • Seat {viewingQrTicketOrder.seat}</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-gray-400 font-mono font-bold uppercase block">Guest Name</span>
                    <span className="text-[10px] font-black text-white uppercase tracking-wider">{viewingQrTicketOrder.guestName}</span>
                  </div>
                </div>

                {viewingQrTicketOrder.notes && (
                  <div className="border-t border-white/5 pt-2">
                    <span className="text-[8px] text-gray-400 font-mono font-bold uppercase block">Special Specs/Notes</span>
                    <p className="text-[9.5px] text-gray-400 leading-tight italic">"{viewingQrTicketOrder.notes}"</p>
                  </div>
                )}
              </div>

              {/* Real QR Code generated using api.qrserver.com */}
              <div className="flex flex-col items-center justify-center space-y-2">
                <div className="w-44 h-44 bg-white p-2.5 rounded-2xl flex items-center justify-center shadow-inner overflow-hidden border border-orange-500/10 hover:scale-[1.01] transition-transform">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&margin=8&data=${encodeURIComponent(
                      `ORDER|id:${viewingQrTicketOrder.id}|type:${viewingQrTicketOrder.type}|name:${viewingQrTicketOrder.itemName}|table:${viewingQrTicketOrder.table}|seat:${viewingQrTicketOrder.seat}|guest:${viewingQrTicketOrder.guestName}|price:${(viewingQrTicketOrder.price || 0).toFixed(2)}|notes:${viewingQrTicketOrder.notes || ''}`
                    )}`}
                    alt="Lounge Order QR Ticket"
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <span className="text-[8px] text-gray-500 font-black uppercase tracking-widest font-mono">Order UUID: {viewingQrTicketOrder.id}</span>
              </div>

              {/* Helpful Explainer */}
              <p className="text-[9.5px] text-gray-400 leading-relaxed max-w-[280px] mx-auto font-medium">
                📲 Show this code on your screen to the bartender. They will scan it with their camera or POS terminal to queue and start making this order immediately!
              </p>

              {/* Dismiss button */}
              <button
                type="button"
                onClick={() => setViewingQrTicketOrder(null)}
                className="w-full py-4 bg-gradient-to-r from-orange-600 to-amber-600 hover:brightness-110 text-white rounded-2xl text-[10.5px] font-black uppercase tracking-widest transition-all cursor-pointer shadow-lg shadow-orange-600/10 active:scale-95"
              >
                Close Ticket Pass
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Geofencing Proximity Detection Pop-up Modal */}
      <AnimatePresence>
        {showLocationPopup && nearestEstablishment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-[#0b0b0b] border border-orange-500/20 max-w-sm w-full p-6 text-center rounded-[2.5rem] shadow-[0_0_50px_rgba(234,88,12,0.15)] space-y-5 relative overflow-hidden"
            >
              {/* Animated glowing bg decoration */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-orange-600/10 rounded-full blur-3xl pointer-events-none" />

              <div className="space-y-2 relative">
                <div className="w-14 h-14 bg-orange-500/10 border border-orange-500/40 text-orange-400 rounded-full mx-auto flex items-center justify-center shadow-lg shadow-orange-500/5 select-none font-sans">
                  <MapPin className="w-7 h-7 text-orange-500 animate-bounce" />
                </div>
                <span className="text-[9px] font-black uppercase text-orange-500 block tracking-widest font-mono">GPS GEOTAG RADIAL CONNECT</span>
                <h3 className="text-lg font-black uppercase text-white tracking-wide">ESTABLISHMENT GEOTAGGED!</h3>
              </div>

              {/* Establishment info */}
              <div className="bg-black/50 border border-white/[0.03] p-4 rounded-2xl relative space-y-1">
                <h4 className="text-xs font-black uppercase text-orange-400 tracking-wider">
                  {nearestEstablishment.name}
                </h4>
                <p className="text-[9px] text-gray-400 font-medium">
                  {nearestEstablishment.address}
                </p>
                <div className="pt-2 mt-2 border-t border-white/[0.04]">
                  <span className="text-[10px] font-mono text-green-400 font-bold bg-green-500/5 px-2 py-0.5 rounded border border-green-500/10 inline-block uppercase">
                    ✓ Verified App Companion Location
                  </span>
                </div>
              </div>

              <p className="text-[9.5px] text-gray-400 leading-relaxed max-w-[280px] mx-auto font-medium">
                Welcome to our lounge floor! Proximity sensors have matched your device with our physical location's smart beverage matrix. Your custom mixers, reviews, and bookings are completely synchronized.
              </p>

              {/* Action buttons */}
              <div className="space-y-2 relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowLocationPopup(false);
                    setPatronSubTab('menu');
                  }}
                  className="w-full py-3.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:brightness-110 text-white rounded-2xl text-[10.5px] font-black uppercase tracking-widest transition-all cursor-pointer shadow-lg shadow-orange-600/10"
                >
                  View Local Drink Menu
                </button>
                <button
                  type="button"
                  onClick={() => setShowLocationPopup(false)}
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer"
                >
                  Dismiss Welcome
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
