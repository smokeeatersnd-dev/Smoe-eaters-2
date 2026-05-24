export interface InventoryItem {
  n: string; // name
  m: number; // min
  p?: number; // par/target level
  u?: string; // unit
  sz?: string; // bottle/package size
  f?: boolean; // flagged low
  c?: number; // cost
  oos?: boolean; // out of stock at distributor
  isMixer?: boolean; // indicates if the item is a mixer
  isFood?: boolean; // indicates if the item is food
  portionCount?: number; // portion count for food items
  overridePrice?: number; // manual override price
}

export interface InventorySchema {
  [distributor: string]: InventoryItem[];
}

export interface StockState {
  [itemName: string]: number;
}

export interface TillLog {
  t?: string; // time
  s: 'Open' | 'Close'; // shift
  date: string;
  m: string; // main till
  d: number; // deposit
  df: string; // diff
  i: string; // name
  ba?: boolean; // bags attention
}

export interface GamingLog {
  t?: string; // time
  ctg: number;
  g: number; // grover
  d: number; // deposit
  p: number; // prev
  tk: number; // tickets
  tt: string; // total
  e?: string; // employee name
}

export interface InvLogEntry {
  t: string; // time
  i: string; // item name or distributor name
  a: 'ADD' | 'TAKE' | 'DONE' | 'SET' | 'CHECK' | 'VERIFIED'; // action
  f?: number; // final count (if applicable)
  d?: string; // distributor (if applicable)
  u?: string; // user/initials
}

export interface TaskLogEntry {
  t: string; // time
  shift: 'opening' | 'closing';
  task: string;
  completed: boolean;
  i?: string; // initials/name
}

export type TaskFrequency = 'daily' | 'weekly' | 'monthly';

export interface Task {
  n: string; // name
  f: TaskFrequency; // frequency
}

export type OrderFrequency = 'daily' | 'weekly' | 'bi-weekly' | 'monthly';

export interface DistributorMetadata {
  orderDay?: string;
  frequency?: OrderFrequency;
  repName?: string;
  email?: string;
  phone?: string;
  paymentTerms?: string;
  deliverySchedule?: string;
  portalUrl?: string;
  portalUsername?: string;
  portalPassword?: string;
}

export type RecipeCategory = 'Cocktail' | 'Shot' | 'Beer' | 'Wine' | 'Non-Alcoholic' | 'Liquor' | 'Specialty' | 'Other';

export interface RecipeReview {
  userName: string;
  liked: boolean;
  comment?: string;
  timestamp: string;
}

export interface Recipe {
  id: string;
  name: string;
  ingredients: { item: string; amount: string }[];
  instructions: string;
  barNotes?: string;
  category: RecipeCategory | string;
  cost?: number;
  baselineCost?: number;
  insight?: string;
  glassware?: string;
  garnish?: string;
  method?: string;
  sellingPrice?: number;
  reviews?: RecipeReview[];
  favoritesCount?: number;
  complexity?: 'Simple' | 'Medium' | 'Complex' | string;
  complexityScore?: number; // 1 to 5
  flavorProfile?: {
    sweet: number;
    sour: number;
    bitter: number;
    boozy: number;
    spicy: number;
    herbal: number;
  };
}

export type EmployeeRole = 'admin' | 'manager' | 'employee' | 'support';

export type Permission = 
  | 'manage_employees'
  | 'manage_distributors'
  | 'manage_inventory'
  | 'manage_shifts'
  | 'approve_shifts'
  | 'manage_tills'
  | 'manage_gaming'
  | 'manage_pos'
  | 'manage_recipes'
  | 'view_logs'
  | 'view_reports'
  | 'edit_settings';

export const ROLE_PERMISSIONS: Record<EmployeeRole, Permission[]> = {
  admin: [
    'manage_employees', 
    'manage_distributors', 
    'manage_inventory', 
    'manage_shifts', 
    'approve_shifts', 
    'manage_tills', 
    'manage_gaming', 
    'manage_pos', 
    'manage_recipes', 
    'view_logs', 
    'view_reports',
    'edit_settings'
  ],
  manager: [
    'manage_inventory', 
    'manage_shifts', 
    'approve_shifts', 
    'manage_tills', 
    'manage_gaming', 
    'manage_recipes', 
    'view_logs'
  ],
  employee: [
    // Standard employees can't manage much, but they can perform actions in the UI
  ],
  support: [
    'view_logs'
  ]
};

export interface Employee {
  id: string;
  name: string;
  pin?: string;
  role: EmployeeRole;
  email?: string;
  phone?: string;
  hireDate?: string;
  allowedTabs?: string[];
  customFields?: Record<string, string>;
}

export interface StaffLogEntry {
  t: string; // time
  e: string; // employee name
  a: 'login' | 'logout' | 'auto-logout'; // action
}

export interface StaffNotification {
  id: string;
  t: 'alert' | 'info' | 'success' | 'task' | 'stock';
  m: string;
  ts: string;
  r: boolean;
  persistent?: boolean;
  targetRole?: EmployeeRole;
  targetUserId?: string;
}

export interface OrderLogEntry {
  t: string; // time (ISO)
  d: string; // distributor
  i: { name: string; amount: number; unit?: string }[]; // items
  m: 'email' | 'sms' | 'copy'; // method
  e: string; // employee
}

export interface AiMixologistSuggestion {
  name: string;
  ingredients: { item: string; amount: string }[];
  instructions: string;
  category: RecipeCategory;
}

export interface PinResetRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  timestamp: string;
  status: 'pending' | 'resolved';
}

export interface PosLogEntry {
  t: string; // time
  provider: string;
  type: 'sales' | 'inventory' | 'test';
  status: 'success' | 'error';
  message: string;
}

export interface AppState {
  tasks: {
    opening: Task[];
    closing: Task[];
  };
  checks: {
    [taskId: string]: boolean;
  };
  inventory: InventorySchema;
  stock: StockState;
  posStock?: StockState;
  tills: TillLog[];
  gaming: GamingLog[];
  invLogs: InvLogEntry[];
  taskLogs: TaskLogEntry[];
  staffLogs?: StaffLogEntry[];
  orderLogs?: OrderLogEntry[];
  employees?: Employee[];
  recipes?: Recipe[];
  helpContent?: string;
  notifications?: StaffNotification[];
  distributorMetadata?: {
    [distributor: string]: DistributorMetadata;
  };
  undepositedTotal?: number;
  messages?: Message[];
  calendarEvents?: CalendarEvent[];
  categoryColors?: CategoryColors;
  defaultReminderOffset?: number;
  posConfig?: PosConfig;
  lastPosSync?: string; // ISO
  posLogs?: PosLogEntry[];
  pinResetRequests?: PinResetRequest[];
  totalInventoryValue?: number;
  pricingConfig?: {
    cogsTarget: number;
    markupFactor: number;
    largeBottlePours: number;
  };
  brandingConfig?: BrandingConfig;
  randomTasksConfig?: RandomTasksConfig;
  commonTitles?: string[];
  commonLocations?: string[];
  scannedInvoices?: any[];
  specials?: Special[];
}

export interface RandomTasksConfig {
  openingEnabled: boolean;
  closingEnabled: boolean;
  openingWeeklyCount: number;
  openingMonthlyCount: number;
  closingWeeklyCount: number;
  closingMonthlyCount: number;
  selectedWeeklyMonthlyTasks: string[]; // List of randomized task names (or combined identifier like 'opening:weekly:Task Name')
  assignments?: AssignedShiftTask[]; // Log and status tracking for personalized random task assignments
  shiftRandomizationEnabled?: boolean; // If enabled, login session has a chance of assigning a random Weekly task
  shiftAssignmentChance?: number; // percentage (1-100)
}

export interface AssignedShiftTask {
  id: string;
  employeeId: string;
  employeeName: string;
  shift: 'opening' | 'closing';
  taskName: string;
  f: 'weekly' | 'monthly';
  date: string; // YYYY-MM-DD
  completed: boolean;
  completedAt?: string;
  loggedOutWithoutCompletion?: boolean;
}

export interface BrandingConfig {
  brandName: string;
  tagline: string;
  logoUrl?: string; // base64 or custom local assets
  employeeGuideTitle?: string;
  foodMenuTitle?: string;
  primaryColor?: string; // e.g. orange
}

export interface PosConfig {
  provider: 'toast' | 'shift4' | 'none';
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  locationId?: string;
  autoSyncInventory: boolean;
  autoSyncSales: boolean;
  syncCategories?: string[]; // categories to filter by
  syncOnlySales?: boolean; // if true, manual sync only does sales
  syncOnlyInventory?: boolean; // if true, manual sync only does inventory
  status: 'connected' | 'disconnected' | 'error';
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string; // ISO
}

export interface CategoryColors {
  shift: string;
  task: string;
  event: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  type: 'shift' | 'event' | 'task' | 'unavailability';
  description?: string;
  assignedTo?: string[]; // employee names
  isOpen?: boolean;
  location?: string;
  isRecurring?: boolean;
  recurrence?: {
    pattern: 'daily' | 'weekly' | 'monthly';
    daysOfWeek?: number[]; // 0-6
    interval?: number; // every X days/weeks/months
    endDate?: string; // ISO date for specific end date
    endAfterCount?: number; // end after X occurrences
  };
  groupId?: string; // for recurring series
  reminderOffset?: number; // in minutes
  isCustomReminder?: boolean;
  requests?: { 
    userId: string; 
    userName: string; 
    timestamp: string; 
    status?: 'pending' | 'approved' | 'denied';
    type?: 'pickup' | 'swap';
    senderShiftId?: string;
  }[];
  status?: 'pending' | 'approved' | 'denied'; 
  reminderSent?: boolean;
}

export interface FoodItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: 'Appetizers' | 'Smoked Mains' | 'Wood-Fired Pizzas' | 'Lighter Side' | 'Desserts';
  tags: string[];
  spicyLevel?: number; // 0 - 3
  isAvailable: boolean;
  associatedStockItem?: string; // name in StockState / Inventory Schema
}

export interface TableAlert {
  id: string;
  table: string;
  seat?: string;
  type: 'call_bartender' | 'order_submitted';
  status: 'active' | 'resolved';
  createdAt: string; // ISO string
  items?: { name: string; quantity: number; price: number }[];
  total?: number;
  guestName?: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface Special {
  id: string;
  type: 'recipe' | 'food';
  name: string;
  discountType: 'percentage' | 'dollar';
  discountValue: number;
  period: 'daily' | 'weekly';
}

