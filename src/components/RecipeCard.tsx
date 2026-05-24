import React, { useState, useMemo } from 'react';
import { 
  Trash2, 
  Sparkles, 
  Calculator, 
  Edit2, 
  Check, 
  PlusCircle, 
  Info, 
  Tag, 
  RefreshCw, 
  Copy, 
  Zap,
  SlidersHorizontal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Recipe, StockState, InventorySchema } from '../types';

interface RecipeCardProps {
  recipe: Recipe;
  stock: StockState;
  inventory: InventorySchema;
  calculateRecipeCost: (recipe: Recipe, forceDynamic?: boolean) => number;
  isAuthenticated: boolean;
  removeRecipe: (id: string) => void;
  updateRecipe: (updated: Recipe) => void;
  setConfirmConfig: React.Dispatch<React.SetStateAction<any>>;
  addNotification: (message: string, type: 'success' | 'alert' | 'info') => void;
  pricingConfig?: { cogsTarget: number; markupFactor: number; largeBottlePours: number };
}

// Map categories to standard glassware, methods, and default selling prices for BOH guidance
const CATEGORY_DEFAULTS: Record<string, { glass: string; method: string; garnish: string; price: number }> = {
  Cocktail: { glass: 'Coupe or Rocks Glass', method: 'Shaken & Double Strained', garnish: 'Orange peel twist', price: 12.00 },
  Shot: { glass: 'Standard 2oz Shot Glass', method: 'Shaken over Ice / Strained', garnish: 'Lime wedge on side', price: 6.00 },
  Beer: { glass: 'Chilled Pint Glass', method: 'Clean Draft Pour (45° angle)', garnish: 'None', price: 6.00 },
  Wine: { glass: 'Standard Wine Glass (5oz pour)', method: 'Direct Pour', garnish: 'None', price: 9.00 },
  Liquor: { glass: 'Snifter or Rocks Glass', method: 'Neat or on the Rocks', garnish: 'None', price: 8.00 },
  Specialty: { glass: 'Highball Glass with crushed ice', method: 'Built in glass & muddled', garnish: 'Fresh Mint sprig & Lime wheel', price: 14.00 },
  'Non-Alcoholic': { glass: 'Collins Glass', method: 'Built / Shaken', garnish: 'Lemon wheel & cherry', price: 5.00 },
  Other: { glass: 'Tumbler Glass', method: 'Built over Ice', garnish: 'None', price: 7.00 },
};

export const RecipeCard: React.FC<RecipeCardProps> = ({
  recipe,
  stock,
  inventory,
  calculateRecipeCost,
  isAuthenticated,
  removeRecipe,
  updateRecipe,
  setConfirmConfig,
  addNotification,
  pricingConfig
}) => {
  const [servings, setServings] = useState<number>(1);
  const [customServings, setCustomServings] = useState<string>('');
  const [showCustomInput, setShowCustomInput] = useState<boolean>(false);
  
  // Specs editing state
  const [isEditingSpecs, setIsEditingSpecs] = useState<boolean>(false);
  const [editedGlass, setEditedGlass] = useState<string>(recipe.glassware || CATEGORY_DEFAULTS[recipe.category]?.glass || 'Standard Glass');
  const [editedMethod, setEditedMethod] = useState<string>(recipe.method || CATEGORY_DEFAULTS[recipe.category]?.method || 'Built');
  const [editedGarnish, setEditedGarnish] = useState<string>(recipe.garnish || CATEGORY_DEFAULTS[recipe.category]?.garnish || 'None');
  const [editedBarNotes, setEditedBarNotes] = useState<string>(recipe.barNotes || '');

  // Selling price editing state
  const [isEditingPrice, setIsEditingPrice] = useState<boolean>(false);
  const [rawPriceInput, setRawPriceInput] = useState<string>((recipe.sellingPrice || CATEGORY_DEFAULTS[recipe.category]?.price || 10).toFixed(2));

  // Determine standard defaults for display fallback
  const defaults = CATEGORY_DEFAULTS[recipe.category] || CATEGORY_DEFAULTS['Other'];
  const glassware = recipe.glassware || defaults.glass;
  const method = recipe.method || defaults.method;
  const garnish = recipe.garnish || defaults.garnish;
  const sellingPrice = recipe.sellingPrice !== undefined ? recipe.sellingPrice : defaults.price;

  // Calculate costs and statistics
  const liveCost = useMemo(() => calculateRecipeCost(recipe, true), [recipe, calculateRecipeCost]);
  const baselineCost = useMemo(() => recipe.baselineCost ?? recipe.cost ?? liveCost, [recipe.baselineCost, recipe.cost, liveCost]);
  const hasCostRisenTenPercent = useMemo(() => baselineCost > 0 && liveCost >= baselineCost * 1.10, [liveCost, baselineCost]);
  const priceIncreasePercent = useMemo(() => baselineCost > 0 ? ((liveCost - baselineCost) / baselineCost) * 100 : 0, [liveCost, baselineCost]);

  const singleCost = liveCost;
  const scaledCost = useMemo(() => singleCost * servings, [singleCost, servings]);
  const pourCostPercent = useMemo(() => {
    if (!sellingPrice || sellingPrice <= 0) return 0;
    return (singleCost / sellingPrice) * 100;
  }, [singleCost, sellingPrice]);

  const suggestedPrice = useMemo(() => {
    const cost = singleCost;
    const cogsTarget = pricingConfig?.cogsTarget ?? 0.25;
    const markupFactor = pricingConfig?.markupFactor ?? 1.09;
    return (cost / cogsTarget) * markupFactor;
  }, [singleCost, pricingConfig]);

  const grossProfitSingle = useMemo(() => {
    return Math.max(0, sellingPrice - singleCost);
  }, [sellingPrice, singleCost]);

  const handleResetBaselineCost = () => {
    const updated: Recipe = {
      ...recipe,
      baselineCost: liveCost,
      cost: liveCost // keep base cost in sync
    };
    updateRecipe(updated);
    addNotification(`Baseline cost for "${recipe.name}" updated to current pricing: $${liveCost.toFixed(2)}`, 'success');
  };

  // Check ingredient inventory availability
  const checkIngredientStock = (ingredientName: string) => {
    const stockKeys = Object.keys(stock);
    const foundKey = stockKeys.find(key => 
      key.toLowerCase().includes(ingredientName.toLowerCase()) || 
      ingredientName.toLowerCase().includes(key.toLowerCase())
    );
    if (!foundKey) return { status: 'out', qty: 0 };
    const qty = stock[foundKey] || 0;
    return { status: qty > 0 ? 'in' : 'out', qty };
  };

  // Get matched inventory item quantity, min threshold, units, and name
  const getIngredientInventoryDetails = (ingredientName: string) => {
    const stockKeys = Object.keys(stock || {});
    const matchedKey = stockKeys.find(key => 
      key.toLowerCase().includes(ingredientName.toLowerCase()) || 
      ingredientName.toLowerCase().includes(key.toLowerCase())
    );

    let matchedItem: any = undefined;
    if (inventory) {
      for (const distributor of Object.keys(inventory)) {
        const items = inventory[distributor] || [];
        const found = items.find(item => 
          (matchedKey && item.n.toLowerCase() === matchedKey.toLowerCase()) || 
          item.n.toLowerCase() === ingredientName.toLowerCase() ||
          item.n.toLowerCase().includes(ingredientName.toLowerCase()) ||
          ingredientName.toLowerCase().includes(item.n.toLowerCase())
        );
        if (found) {
          matchedItem = found;
          break;
        }
      }
    }

    const qty = matchedKey ? (stock[matchedKey] ?? 0) : 0;
    const minThreshold = matchedItem ? (matchedItem.m ?? 0) : 0;
    const parValue = matchedItem ? matchedItem.p : undefined;
    const unit = matchedItem ? (matchedItem.u || 'pcs') : 'units';
    const isMatched = !!matchedItem;
    const matchedItemName = matchedItem ? matchedItem.n : (matchedKey || ingredientName);

    return {
      qty,
      minThreshold,
      parValue,
      unit,
      isMatched,
      matchedItemName
    };
  };

  // Advanced scale factor helper: robustly parses fractions, decimals, and words
  const scaleAmount = (amountStr: string, multiplier: number) => {
    if (multiplier === 1 || !amountStr) return amountStr;
    
    let formatted = amountStr;
    // Standardize spacing around fractions
    formatted = formatted.replace(/\s+/g, ' ');
    
    // Convert fractions like "1 1/2" to decimals first
    const mixedFractionRegex = /(\d+)\s+(\d+)\/(\d+)/g;
    formatted = formatted.replace(mixedFractionRegex, (_, whole, num, den) => {
      return (parseFloat(whole) + parseFloat(num) / parseFloat(den)).toString();
    });

    // Convert standard single fractions like "1/2" or "3/4"
    const fractionRegex = /(\d+)\/(\d+)/g;
    formatted = formatted.replace(fractionRegex, (_, num, den) => {
      return (parseFloat(num) / parseFloat(den)).toString();
    });

    // Scale all numbers in the string
    const numRegex = /(\d+\.?\d*)/g;
    const scaled = formatted.replace(numRegex, (match) => {
      const val = parseFloat(match);
      if (isNaN(val)) return match;
      const multipliedValue = val * multiplier;
      // Format cleanly with a max of 2 decimal places, removing trailing zeros
      return parseFloat(multipliedValue.toFixed(2)).toString();
    });

    // Fix fraction presentation if it was originally an oz/ml string
    return scaled;
  };

  // Calculate aggregate custom yield volume for prep purposes
  const getBatchYieldStr = () => {
    let totalOunces = 0;
    recipe.ingredients.forEach(ing => {
      const lowerAmt = ing.amount.toLowerCase();
      // Parse out fractional numbers or standard decimals
      let amountStr = lowerAmt.replace(/[^0-9./\s]/g, '').trim();
      let amountNum = 0;
      
      if (amountStr) {
        if (amountStr.includes(' ')) {
          // Mixed fraction or sum list
          const parts = amountStr.split(/\s+/);
          parts.forEach(p => {
            if (p.includes('/')) {
              const f = p.split('/');
              amountNum += (parseFloat(f[0]) / parseFloat(f[1])) || 0;
            } else {
              amountNum += parseFloat(p) || 0;
            }
          });
        } else if (amountStr.includes('/')) {
          const f = amountStr.split('/');
          amountNum = (parseFloat(f[0]) / parseFloat(f[1])) || 0;
        } else {
          amountNum = parseFloat(amountStr) || 0;
        }
      }

      if (amountNum > 0) {
        if (lowerAmt.includes('oz') || lowerAmt.includes('ounce') || lowerAmt.includes('ounces')) {
          totalOunces += amountNum * servings;
        } else if (lowerAmt.includes('ml')) {
          totalOunces += amountNum * 0.033814 * servings;
        } else if (lowerAmt.includes('cl')) {
          totalOunces += amountNum * 0.33814 * servings;
        } else if (lowerAmt.includes('l') && !lowerAmt.includes('ml') && !lowerAmt.includes('cl')) {
          totalOunces += amountNum * 33.814 * servings;
        }
      }
    });

    if (totalOunces === 0) return null;
    if (totalOunces < 32) {
      return `Total Yield: ~${totalOunces.toFixed(1)} fl oz (${(totalOunces * 29.5735).toFixed(0)} ml)`;
    }
    
    const liters = totalOunces * 0.0295735;
    const gallons = totalOunces * 0.0078125;
    return `Total Yield: ~${totalOunces.toFixed(0)} fl oz (~${liters.toFixed(2)} Liters / ~${gallons.toFixed(2)} Gal)`;
  };

  // Handle saving customized specifications
  const handleSaveSpecs = () => {
    const updated: Recipe = {
      ...recipe,
      glassware: editedGlass.trim() || undefined,
      method: editedMethod.trim() || undefined,
      garnish: editedGarnish.trim() || undefined,
      barNotes: editedBarNotes.trim() || undefined
    };
    updateRecipe(updated);
    setIsEditingSpecs(false);
    addNotification(`Specifications saved for "${recipe.name}"`, 'success');
  };

  // Handle saving customized selling price
  const handleSavePrice = () => {
    const priceNum = parseFloat(rawPriceInput);
    if (isNaN(priceNum) || priceNum < 0) {
      addNotification('Please enter a valid numeric selling price.', 'alert');
      return;
    }
    const updated: Recipe = {
      ...recipe,
      sellingPrice: priceNum
    };
    updateRecipe(updated);
    setIsEditingPrice(false);
    addNotification(`Selling price for "${recipe.name}" updated with $${priceNum.toFixed(2)}`, 'success');
  };

  // Handle scaling presets
  const handleSelectServings = (val: number) => {
    setServings(val);
    setShowCustomInput(false);
  };

  // Handle copying batch formulation to clipboard (phenomenal BOH UX!)
  const handleCopyFormulation = () => {
    const lines = [
      `🍹 BATCH FORMULATION: ${recipe.name.toUpperCase()} (${servings} Serving${servings > 1 ? 's' : ''})`,
      `==============================`,
      `Category: ${recipe.category}`,
      `Glassware: ${glassware}`,
      `Method: ${method}`,
      `Garnish: ${garnish}`,
      `------------------------------`,
      `INGREDIENT MEASUREMENTS:`,
      ...recipe.ingredients.map(ing => `- ${ing.item}: ${scaleAmount(ing.amount, servings)}`),
      `------------------------------`,
      `PREPARATION INSTRUCTIONS:`,
      recipe.instructions,
      `------------------------------`,
      getBatchYieldStr() ? getBatchYieldStr() : '',
      `Total Cost contribution: $${scaledCost.toFixed(2)}`,
      `Generated in back-of-house operational suite - ${new Date().toLocaleDateString()}`
    ].filter(Boolean);

    navigator.clipboard.writeText(lines.join('\n'));
    addNotification(`Batch formulation copied to clipboard!`, 'success');
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -16 }}
      whileHover={{ y: -5, scale: 1.015 }}
      transition={{ 
        layout: { type: 'spring', stiffness: 260, damping: 28 },
        opacity: { duration: 0.22, ease: 'easeOut' },
        scale: { type: 'spring', stiffness: 300, damping: 24 },
        y: { type: 'spring', stiffness: 300, damping: 24 }
      }}
      className={`bg-black/20 flex flex-col p-5 rounded-2xl transition-all group relative overflow-visible border ${
        hasCostRisenTenPercent 
          ? 'border-red-500/40 shadow-lg shadow-red-500/5 hover:border-red-500/70 hover:shadow-red-500/10' 
          : 'border-[#333] hover:border-orange-500/30 hover:shadow-2xl hover:shadow-orange-500/[0.02]'
      }`}
    >
      
      {/* Visual background atmospheric accent wrapper with overflow-hidden boundary */}
      <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none z-0">
        <div className={`absolute top-0 right-0 w-32 h-32 opacity-[0.02] rounded-full translate-x-10 -translate-y-10 blur-xl ${
          hasCostRisenTenPercent ? 'bg-red-500 opacity-[0.08]' :
          recipe.category === 'Cocktail' ? 'bg-orange-500' :
          recipe.category === 'Shot' ? 'bg-red-500' :
          recipe.category === 'Beer' ? 'bg-yellow-500' :
          recipe.category === 'Wine' ? 'bg-purple-500' :
          'bg-indigo-500'
        }`} />
      </div>

      {/* Header Info */}
      <div className="flex items-start justify-between mb-4 z-10">
        <div>
          <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded mb-1.5 inline-block ${
            recipe.category === 'Cocktail' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/10' :
            recipe.category === 'Shot' ? 'bg-red-500/10 text-red-500 border border-red-500/10' :
            recipe.category === 'Beer' ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/10' :
            recipe.category === 'Wine' ? 'bg-purple-500/10 text-purple-500 border border-purple-500/10' :
            recipe.category === 'Liquor' ? 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/10' :
            recipe.category === 'Specialty' ? 'bg-pink-500/10 text-pink-500 border border-pink-500/10' :
            recipe.category === 'Non-Alcoholic' ? 'bg-green-500/10 text-green-500 border border-green-500/10' :
            'bg-gray-500/10 text-gray-400'
          }`}>{recipe.category}</span>
          
          {hasCostRisenTenPercent && (
            <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded mb-1.5 inline-block bg-dash-red bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse ml-2" title="Price of ingredients has risen by more than 10% compared to baseline!">
              ⚠️ Profit Risk (+{priceIncreasePercent.toFixed(0)}%)
            </span>
          )}
          <h3 className="font-extrabold text-lg text-white leading-tight tracking-tight group-hover:text-orange-500/90 transition-colors uppercase italic">{recipe.name}</h3>
        </div>
        
        {/* Controls */}
        <div className="flex gap-2 shrink-0">
          {isAuthenticated && (
            <button 
              onClick={() => {
                setConfirmConfig({
                  show: true,
                  title: 'Delete Recipe',
                  message: `Are you sure you want to permanently delete the recipe for "${recipe.name}"?`,
                  type: 'danger',
                  onConfirm: () => {
                    removeRecipe(recipe.id);
                    setConfirmConfig((p: any) => ({ ...p, show: false }));
                  }
                });
              }}
              className="p-1.5 text-gray-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
              title="Delete Recipe"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Financial Health & Portions Analysis panel */}
      <div className="bg-black/35 rounded-xl border border-white/5 p-3.5 mb-4 space-y-2.5">
        <div className="flex justify-between items-start gap-2">
          {/* Cost display */}
          <div className="flex flex-col">
            <span className="text-[7px] text-gray-500 uppercase font-black tracking-widest leading-none">Est. BOH Cost</span>
            <span className={`text-base font-black font-mono mt-0.5 ${
              hasCostRisenTenPercent 
                ? 'text-red-500 animate-pulse' 
                : singleCost > 5 ? 'text-red-400' : 'text-green-400'
            }`}>
              ${singleCost.toFixed(2)}
            </span>
          </div>

          {/* Dynamic Selling Price Editor */}
          <div className="flex flex-col items-end">
            <span className="text-[7px] text-gray-500 uppercase font-black tracking-widest leading-none mb-0.5">Est. Retail Price</span>
            {isEditingPrice ? (
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-xs font-bold text-gray-500">$</span>
                <input
                  type="text"
                  value={rawPriceInput}
                  onChange={e => setRawPriceInput(e.target.value)}
                  className="w-16 bg-[#262626] border border-[#444] text-white font-mono text-center text-xs py-0.5 rounded outline-none focus:border-orange-500"
                  autoFocus
                  onBlur={handleSavePrice}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSavePrice();
                    if (e.key === 'Escape') {
                      setRawPriceInput(sellingPrice.toFixed(2));
                      setIsEditingPrice(false);
                    }
                  }}
                />
                <button 
                  onClick={handleSavePrice}
                  className="p-0.5 text-emerald-400 hover:bg-emerald-500/10 rounded"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 group/price cursor-pointer mt-0.5" onClick={() => setIsEditingPrice(true)} title="Set custom selling price">
                <span className="text-base font-black font-mono text-white select-none">
                  ${sellingPrice.toFixed(2)}
                </span>
                <Edit2 className="w-3 h-3 text-gray-500 group-hover/price:text-orange-500 opacity-0 group-hover/price:opacity-100 transition-all ml-0.5" />
              </div>
            )}
          </div>
        </div>

        {/* Suggested price indicator instead of Pour Cost */}
        <div className="pt-2 border-t border-white/5 flex flex-col gap-1.5">
          <div className="flex justify-between items-center text-[10px]">
            <div className="flex items-center gap-1">
              <span className="text-gray-500 font-bold uppercase">Suggested Price:</span>
              <span className="text-indigo-400 font-black font-mono">
                ${suggestedPrice.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 font-bold uppercase">Est. Cost:</span>
              <span className={`font-bold font-mono ${hasCostRisenTenPercent ? 'text-red-400 font-extrabold' : 'text-gray-400 font-bold'}`}>
                ${singleCost.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Baseline details and action button with reset */}
          <div className="flex justify-between items-center text-[9px] border-t border-white/5 pt-1.5 mt-1">
            <span className="text-gray-500 font-bold">Baseline Cost: <span className="text-gray-400 font-mono">${baselineCost.toFixed(2)}</span></span>
            {hasCostRisenTenPercent ? (
              <div className="flex items-center gap-1.5">
                <span className="text-red-400 font-extrabold uppercase animate-pulse">+{priceIncreasePercent.toFixed(1)}% Rise</span>
                {isAuthenticated && (
                  <button
                    onClick={handleResetBaselineCost}
                    className="px-1.5 py-0.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 text-[8px] font-black uppercase tracking-wide rounded cursor-pointer transition-all"
                    title="Acknowledge price change and update baseline cost"
                  >
                    Set Base
                  </button>
                )}
              </div>
            ) : (
              <span className="text-emerald-500 font-extrabold uppercase text-[8px]">Stable Cost (Normal Range)</span>
            )}
          </div>
        </div>
      </div>

      {/* Specifications & Mixing standards */}
      <div className="bg-black/10 rounded-xl p-3 border border-white/5 space-y-2 mb-4 leading-relaxed flex-grow">
        
        {/* Specs Toggle Row */}
        <div className="flex justify-between items-center pb-2 border-b border-white/5">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Service Specifications</p>
          <button
            onClick={() => setIsEditingSpecs(prev => !prev)}
            className="text-[8px] uppercase tracking-widest font-black text-orange-500 hover:text-orange-400 flex items-center gap-1 transition-colors"
          >
            {isEditingSpecs ? 'Cancel' : 'Edit Specs'}
          </button>
        </div>

        {isEditingSpecs ? (
          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <label className="text-[8px] font-black text-gray-500 uppercase">Glassware</label>
              <input
                type="text"
                value={editedGlass}
                onChange={e => setEditedGlass(e.target.value)}
                placeholder="Glass type..."
                className="bg-[#262626] border border-[#444] text-white text-xs rounded-lg p-2 w-full outline-none focus:border-orange-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black text-gray-500 uppercase">Prep Method</label>
              <select
                value={editedMethod}
                onChange={e => setEditedMethod(e.target.value)}
                className="bg-[#262626] border border-[#444] text-white text-xs rounded-lg p-2 w-full outline-none focus:border-orange-500 cursor-pointer"
              >
                <option value="Shaken & Double Strained">Shaken & Double Strained</option>
                <option value="Stirred & Strained">Stirred & Strained</option>
                <option value="Built in glass">Built in glass</option>
                <option value="Muddled & Built">Muddled & Built</option>
                <option value="Blended / Frozen">Blended / Frozen</option>
                <option value="Layered pour">Layered pour</option>
                <option value="Direct pour (draft/wine)">Direct pour (draft/wine)</option>
              </select>
            </div>
            <div className="space-y-1 font-sans">
              <label className="text-[8px] font-black text-gray-500 uppercase">Garnish</label>
              <input
                type="text"
                value={editedGarnish}
                onChange={e => setEditedGarnish(e.target.value)}
                placeholder="Garnish..."
                className="bg-[#262626] border border-[#444] text-white text-xs rounded-lg p-2 w-full outline-none focus:border-orange-500 font-sans"
              />
            </div>
            <div className="space-y-1 font-sans">
              <label className="text-[8px] font-black text-gray-500 uppercase">Bar Notes / Prep Guidance</label>
              <textarea
                value={editedBarNotes}
                onChange={e => setEditedBarNotes(e.target.value)}
                placeholder="e.g. double strain into chilled coupe..."
                rows={2}
                className="bg-[#262626] border border-[#444] text-white text-xs rounded-lg p-2 w-full outline-none focus:border-orange-500 resize-none font-sans"
              />
            </div>
            <button
              onClick={handleSaveSpecs}
              className="w-full bg-orange-600 hover:bg-orange-500 text-white py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all shadow"
            >
              <Check className="w-3.5 h-3.5" /> Save Specifications
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 py-1">
            <div className="flex flex-col bg-white/[0.01] p-1.5 rounded-lg border border-white/5 select-none" title="Glassware selection for serving">
              <span className="text-[7px] font-black text-gray-600 uppercase tracking-tighter">Glass</span>
              <span className="text-[10px] font-bold text-gray-300 tracking-tight break-words whitespace-normal mt-0.5 leading-tight">{glassware}</span>
            </div>
            <div className="flex flex-col bg-white/[0.01] p-1.5 rounded-lg border border-white/5 select-none" title="Mixing standards">
              <span className="text-[7px] font-black text-gray-600 uppercase tracking-tighter">Method</span>
              <span className="text-[10px] font-bold text-gray-300 tracking-tight break-words whitespace-normal mt-0.5 leading-tight">{method}</span>
            </div>
            <div className="flex flex-col bg-white/[0.01] p-1.5 rounded-lg border border-white/5 select-none" title="Finish guidelines">
              <span className="text-[7px] font-black text-gray-600 uppercase tracking-tighter">Garnish</span>
              <span className="text-[10px] font-bold text-gray-300 tracking-tight break-words whitespace-normal mt-0.5 leading-tight">{garnish}</span>
            </div>
          </div>
        )}
      </div>

      {/* Dynamic Portion & Batch Control area */}
      <div className="bg-[#1c1c1c] border border-orange-500/10 rounded-xl p-3.5 space-y-3 mb-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1.5">
            <Calculator className="w-3.5 h-3.5 text-orange-500" />
            <p className="text-[9px] font-black uppercase tracking-widest text-orange-400 leading-none">Batch & Servings scale</p>
          </div>
          {servings > 1 && (
            <span className="text-[9px] font-black text-orange-500 font-mono tracking-wider bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/15 animate-pulse">
              MULTIPLIER: {servings}X
            </span>
          )}
        </div>

        {/* Portion Chips */}
        <div className="flex flex-wrap gap-1.5">
          <button 
            type="button"
            onClick={() => handleSelectServings(1)}
            className={`px-2.5 py-1 text-[9px] font-bold tracking-tight rounded-md select-none transition-all ${
              servings === 1 
                ? 'bg-orange-600 text-white font-extrabold shadow-sm' 
                : 'bg-black/40 text-gray-400 hover:text-white border border-white/5'
            }`}
          >
            Single (1x)
          </button>
          <button 
            type="button"
            onClick={() => handleSelectServings(4)}
            className={`px-2.5 py-1 text-[9px] font-bold tracking-tight rounded-md select-none transition-all ${
              servings === 4 
                ? 'bg-orange-600 text-white font-extrabold shadow-sm' 
                : 'bg-black/40 text-gray-400 hover:text-white border border-white/5'
            }`}
          >
            Shaker (4x)
          </button>
          <button 
            type="button"
            onClick={() => handleSelectServings(10)}
            className={`px-2.5 py-1 text-[9px] font-bold tracking-tight rounded-md select-none transition-all ${
              servings === 10 
                ? 'bg-orange-600 text-white font-extrabold shadow-sm' 
                : 'bg-black/40 text-gray-400 hover:text-white border border-white/5'
            }`}
          >
            Carafe (10x)
          </button>
          <button 
            type="button"
            onClick={() => handleSelectServings(25)}
            className={`px-2.5 py-1 text-[9px] font-bold tracking-tight rounded-md select-none transition-all ${
              servings === 25 
                ? 'bg-orange-600 text-white font-extrabold shadow-sm' 
                : 'bg-black/40 text-gray-400 hover:text-white border border-white/5'
            }`}
          >
            Punch (25x)
          </button>
          <button 
            type="button"
            onClick={() => handleSelectServings(50)}
            className={`px-2.5 py-1 text-[9px] font-bold tracking-tight rounded-md select-none transition-all ${
              servings === 50
                ? 'bg-orange-600 text-white font-extrabold shadow-sm' 
                : 'bg-black/40 text-gray-400 hover:text-white border border-white/5'
            }`}
          >
            Dispenser (50x)
          </button>
          <button 
            type="button"
            onClick={() => setShowCustomInput(!showCustomInput)}
            className={`p-1 text-[9px] tracking-tight rounded-md select-none transition-all border border-dashed flex items-center justify-center ${
              showCustomInput || (servings !== 1 && servings !== 4 && servings !== 10 && servings !== 25 && servings !== 50)
                ? 'bg-orange-500/15 border-orange-500 text-orange-400' 
                : 'border-white/10 text-gray-500 hover:text-gray-300'
            }`}
            title="Custom servings multiplier"
          >
            <SlidersHorizontal className="w-3 h-3" />
          </button>
        </div>

        {/* Custom Input Panel toggle */}
        <AnimatePresence>
          {showCustomInput && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden space-y-1.5"
            >
              <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest">Enter Custom serving scale factor</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  max="5000"
                  value={customServings}
                  onChange={e => setCustomServings(e.target.value)}
                  placeholder="e.g. 100 servings..."
                  className="bg-black/40 border border-white/10 text-white text-xs rounded-lg p-2 flex-grow outline-none focus:border-orange-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    const parsed = parseInt(customServings);
                    if (parsed && parsed >= 1) {
                      setServings(parsed);
                    } else {
                      addNotification('Please enter a count greater than or equal to 1', 'alert');
                    }
                  }}
                  className="bg-orange-600 hover:bg-orange-500 text-white px-3 py-2 text-[9px] font-black uppercase rounded-lg tracking-widest transition-all"
                >
                  Scale
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Ingredients List with scaled measurements */}
      <div className="space-y-4 flex-grow mb-4">
        <div className="space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Ingredients (Scaled)</p>
          <ul className="space-y-1">
            {recipe.ingredients.map((ing, i) => {
              const stockCheck = checkIngredientStock(ing.item);
              const scaledMeasure = scaleAmount(ing.amount, servings);
              const invDetails = getIngredientInventoryDetails(ing.item);
              
              return (
                <li key={i} className="flex justify-between items-center text-xs border-b border-white/5 pb-1 last:border-0 hover:bg-white/[0.01] px-1 rounded transition-colors group/ing relative">
                  {/* Tooltip containing inventory details */}
                  <div className="absolute bottom-full left-0 mb-1.5 w-60 bg-[#161616] border border-[#333] rounded-xl p-3 shadow-2xl shadow-black/80 z-[120] pointer-events-none opacity-0 invisible group-hover/ing:opacity-100 group-hover/ing:visible transition-all duration-200">
                    <div className="flex flex-col gap-1.5 text-[10px] text-gray-400 text-left">
                      <div className="flex items-center justify-between border-b border-[#2d2d2d] pb-1.5 mb-1">
                        <span className="font-extrabold text-gray-500 uppercase tracking-wider text-[8px]">Stock Readiness</span>
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                          invDetails.isMatched ? 'bg-orange-500/10 text-orange-400' : 'bg-gray-500/10 text-gray-400'
                        }`}>
                          {invDetails.isMatched ? 'Inventory Mapped' : 'Not Found'}
                        </span>
                      </div>
                      <p className="font-bold text-white text-xs leading-snug tracking-tight mb-1 break-words">
                        {invDetails.matchedItemName}
                      </p>
                      <div className="grid grid-cols-2 gap-2 mt-0.5">
                        <div className="bg-black/30 p-1.5 rounded-lg border border-white/5">
                          <span className="text-[7px] font-bold uppercase text-gray-500">On Hand</span>
                          <p className={`text-xs font-black font-mono mt-0.5 ${
                            invDetails.qty < invDetails.minThreshold ? 'text-red-400' : 'text-green-400'
                          }`}>
                            {invDetails.qty} <span className="text-[8px] font-bold text-gray-500 font-sans">{invDetails.unit}</span>
                          </p>
                        </div>
                        <div className="bg-black/30 p-1.5 rounded-lg border border-white/5">
                          <span className="text-[7px] font-bold uppercase text-gray-500">Min Alert</span>
                          <p className="text-xs font-black font-mono mt-0.5 text-gray-300">
                            {invDetails.minThreshold} <span className="text-[8px] font-bold text-gray-500 font-sans">{invDetails.unit}</span>
                          </p>
                        </div>
                      </div>
                      {invDetails.parValue !== undefined && (
                        <div className="flex justify-between items-center bg-black/15 px-2 py-1 rounded-md border border-white/5 text-[8px] font-bold text-gray-500">
                          <span>PAR Target Level:</span>
                          <span className="text-white font-mono">{invDetails.parValue} {invDetails.unit}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 min-w-[65%]">
                    <span 
                      className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                        stockCheck.status === 'in' ? 'bg-green-500 shadow-[0_0_4px_#22c55e]' : 'bg-red-500'
                      }`}
                      title={`${ing.item} in stock status: ${stockCheck.status === 'in' ? 'Stock Available' : 'Out of Stock'}`}
                    />
                    <span className="text-gray-300 font-medium break-words whitespace-normal leading-tight">{ing.item}</span>
                  </div>
                  <span className="text-orange-400 font-black italic select-all font-mono py-0.5 px-1.5 rounded bg-orange-500/5 group-hover/ing:bg-orange-500/10 transition-all">{scaledMeasure}</span>
                </li>
              );
            })}
          </ul>
        </div>
        
        {/* Total Yield preview display */}
        {servings > 1 && getBatchYieldStr() && (
          <div className="bg-orange-500/5 border border-orange-500/15 rounded-xl p-2.5 flex items-center gap-1.5 select-none font-mono">
            <Zap className="w-3.5 h-3.5 text-orange-500 shrink-0" />
            <p className="text-[9px] text-orange-400 font-black tracking-tight leading-none uppercase">{getBatchYieldStr()}</p>
          </div>
        )}
        
        {/* Total Batch cost estimator display */}
        {servings > 1 && (
          <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-wide text-gray-500 select-none px-1">
            <span>Total Batch BOH Cost contribution:</span>
            <span className="text-white font-mono">${scaledCost.toFixed(2)}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Method & Mixing instructions</p>
          <p className="text-xs text-gray-400 leading-relaxed italic select-text break-words whitespace-pre-wrap">"{recipe.instructions}"</p>
        </div>

        {recipe.barNotes && (
          <div className="space-y-1 bg-amber-500/5 p-3 rounded-2xl border border-amber-500/15 font-sans">
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-500 select-none">Bar Notes (Service Guidance)</p>
            <p className="text-xs text-amber-300 font-semibold italic select-text break-words whitespace-pre-wrap">"{recipe.barNotes}"</p>
          </div>
        )}

        {recipe.insight && (
          <div className="bg-orange-500/5 border border-orange-500/10 rounded-xl p-3 flex items-start gap-2 mt-2">
            <Sparkles className="w-3 h-3 text-orange-500/40 shrink-0 mt-0.5" />
            <p className="text-[10px] text-gray-400 font-medium leading-normal italic break-words whitespace-normal">{recipe.insight}</p>
          </div>
        )}

        {/* Customer Favorites & Reviews Tracker for BOH Barmembers/Staff */}
        {recipe.favoritesCount !== undefined && recipe.favoritesCount > 0 && (
          <div className="mt-4 flex items-center gap-1.5 bg-red-500/5 border border-red-500/10 px-3 py-1.5 rounded-xl">
            <span className="text-[9px] font-black uppercase tracking-wider text-red-400 flex items-center gap-1 leading-none">
              ❤️ {recipe.favoritesCount} Customer {recipe.favoritesCount === 1 ? 'Favorite' : 'Favorites'}!
            </span>
          </div>
        )}

        {recipe.reviews && recipe.reviews.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-white/5 pt-3.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#ea580c] flex items-center gap-1 leading-none">
              💬 Customer Reviews ({recipe.reviews.length})
            </p>
            <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
              {recipe.reviews.map((rev, revIdx) => (
                <div key={revIdx} className="bg-white/[0.02] border border-white/[0.03] rounded-xl p-2.5 text-[10px] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-white uppercase">{rev.userName}</span>
                    <span className={`text-[8px] font-black uppercase tracking-widest ${rev.liked ? 'text-green-400' : 'text-red-400'}`}>
                      {rev.liked ? '👍 Like' : '👎 Dislike'}
                    </span>
                  </div>
                  {rev.comment && (
                    <p className="text-gray-400 italic font-semibold leading-relaxed">"{rev.comment}"</p>
                  )}
                  <p className="text-[7.5px] text-gray-400/65 font-mono text-right">{rev.timestamp}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Copy / Print Preparation Form Tool Card */}
      {servings > 1 && (
        <button
          type="button"
          onClick={handleCopyFormulation}
          className="w-full bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/15 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all mt-auto shadow select-none"
        >
          <Copy className="w-3.5 h-3.5 text-orange-400" />
          Copy Prep Card ({servings}X Servings)
        </button>
      )}
    </motion.div>
  );
};
