import React, { useState, useEffect, useMemo } from 'react';
import { 
  Radar, 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis, 
  ResponsiveContainer, 
  Tooltip 
} from 'recharts';
import { 
  SlidersHorizontal, 
  BookOpen, 
  Award, 
  Flame, 
  Sparkles, 
  Check, 
  RotateCcw, 
  Save,
  ChevronRight,
  TrendingUp,
  Glasses
} from 'lucide-react';
import { Recipe } from '../types';
import { motion } from 'motion/react';

interface RecipeRadarProps {
  recipes: Recipe[];
  updateRecipe: (updated: Recipe) => void;
  addNotification: (message: string, type: 'success' | 'alert' | 'info') => void;
}

// Helper to compute smart default flavor profile
const getSmartDefaultFlavor = (recipe: Recipe) => {
  const name = recipe.name.toLowerCase();
  const category = String(recipe.category).toLowerCase();
  const instrs = recipe.instructions.toLowerCase();
  
  const profile = {
    sweet: 3,
    sour: 2,
    bitter: 1,
    boozy: 5,
    spicy: 0,
    herbal: 1
  };

  // Category heuristics
  if (category.includes('beer')) {
    profile.bitter = 5;
    profile.boozy = 3;
    profile.sweet = 1;
    profile.herbal = 4;
  } else if (category.includes('wine')) {
    profile.sweet = 3;
    profile.sour = 4;
    profile.boozy = 4;
    profile.herbal = 5;
  } else if (category.includes('non-alcoholic') || category.includes('mocktail')) {
    profile.sweet = 6;
    profile.sour = 4;
    profile.boozy = 0;
    profile.herbal = 2;
  } else if (category.includes('shot')) {
    profile.boozy = 8;
    profile.sweet = 4;
    profile.sour = 2;
  } else if (category.includes('liquor')) {
    profile.boozy = 9;
    profile.bitter = 4;
    profile.sweet = 1;
  }

  // Keywords heuristcs
  if (name.includes('bloody') || name.includes('mary') || name.includes('spicy') || instrs.includes('jalapeño') || instrs.includes('pepper') || instrs.includes('tabasco') || instrs.includes('hot')) {
    profile.spicy = 8;
    profile.bitter = 3;
    profile.sour = 4;
    profile.sweet = 2;
  }
  if (name.includes('margarita') || name.includes('sour') || name.includes('lime') || name.includes('lemon') || instrs.includes('citrus')) {
    profile.sour = 7;
    profile.sweet = 5;
  }
  if (name.includes('sweet') || name.includes('mojito') || name.includes('syrup') || instrs.includes('sugar') || instrs.includes('simple syrup')) {
    profile.sweet = 7;
  }
  if (name.includes('old fashioned') || name.includes('manhattan') || instrs.includes('bitters') || name.includes('negroni')) {
    profile.bitter = 6;
    profile.boozy = 8;
    profile.sweet = 3;
  }
  if (instrs.includes('mint') || instrs.includes('rosemary') || instrs.includes('basil') || instrs.includes('botanical') || name.includes('gin')) {
    profile.herbal = 7;
  }

  return profile;
};

// Helper to compute smart default complexity level
const getSmartDefaultComplexity = (recipe: Recipe) => {
  const ingCount = recipe.ingredients.length;
  const instrs = recipe.instructions.toLowerCase();
  
  let score = 2; // default moderate
  
  if (ingCount <= 1) {
    score = 1;
  } else if (ingCount === 2) {
    score = 2;
  } else if (ingCount === 3) {
    score = 3;
  } else if (ingCount === 4) {
    score = 4;
  } else if (ingCount >= 5) {
    score = 5;
  }

  // Technique modifiers
  if (instrs.includes('muddle') || instrs.includes('double strain') || instrs.includes('smoke') || instrs.includes('layer') || instrs.includes('egg white') || instrs.includes('infuse')) {
    score = Math.min(5, score + 1);
  }

  let text = 'Medium';
  if (score <= 2) text = 'Simple';
  else if (score >= 4) text = 'Complex';

  return { score, text };
};

export const RecipeRadar: React.FC<RecipeRadarProps> = ({
  recipes,
  updateRecipe,
  addNotification
}) => {
  // Select active recipe ID
  const [selectedId, setSelectedId] = useState<string>('');

  // Handle recipe list updates or initial selections
  useEffect(() => {
    if (recipes.length > 0) {
      if (!selectedId || !recipes.some(r => r.id === selectedId)) {
        setSelectedId(recipes[0].id);
      }
    }
  }, [recipes, selectedId]);

  // Find currently active recipe
  const activeRecipe = useMemo(() => {
    return recipes.find(r => r.id === selectedId);
  }, [recipes, selectedId]);

  // Local state for flavor metrics (syncs on select change)
  const [sweet, setSweet] = useState<number>(5);
  const [sour, setSour] = useState<number>(3);
  const [bitter, setBitter] = useState<number>(2);
  const [boozy, setBoozy] = useState<number>(4);
  const [spicy, setSpicy] = useState<number>(0);
  const [herbal, setHerbal] = useState<number>(2);

  // Local state for complexity rating
  const [complexityScore, setComplexityScore] = useState<number>(3);
  const [complexityText, setComplexityText] = useState<string>('Medium');

  // Active sync flags
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);

  // Load recipe values into local states when active recipe shifts
  useEffect(() => {
    if (activeRecipe) {
      const flavor = activeRecipe.flavorProfile || getSmartDefaultFlavor(activeRecipe);
      setSweet(flavor.sweet);
      setSour(flavor.sour);
      setBitter(flavor.bitter);
      setBoozy(flavor.boozy);
      setSpicy(flavor.spicy);
      setHerbal(flavor.herbal);

      if (activeRecipe.complexityScore !== undefined) {
        setComplexityScore(activeRecipe.complexityScore);
        setComplexityText(activeRecipe.complexity || 'Medium');
      } else {
        const comp = getSmartDefaultComplexity(activeRecipe);
        setComplexityScore(comp.score);
        setComplexityText(comp.text);
      }
      setHasUnsavedChanges(false);
    }
  }, [activeRecipe]);

  // Re-calculate Recharts structured format on value change
  const chartData = useMemo(() => {
    return [
      { name: 'Sweet', value: sweet, fullMark: 10 },
      { name: 'Sour', value: sour, fullMark: 10 },
      { name: 'Bitter', value: bitter, fullMark: 10 },
      { name: 'Boozy', value: boozy, fullMark: 10 },
      { name: 'Spicy', value: spicy, fullMark: 10 },
      { name: 'Herbal', value: herbal, fullMark: 10 }
    ];
  }, [sweet, sour, bitter, boozy, spicy, herbal]);

  if (recipes.length === 0 || !activeRecipe) {
    return null;
  }

  // Handle saving modified values back to application list state
  const handleSaveProfile = () => {
    if (!activeRecipe) return;

    const updatedRecipe: Recipe = {
      ...activeRecipe,
      complexity: complexityText,
      complexityScore: complexityScore,
      flavorProfile: {
        sweet,
        sour,
        bitter,
        boozy,
        spicy,
        herbal
      }
    };

    updateRecipe(updatedRecipe);
    setHasUnsavedChanges(false);
    addNotification(`Saved flavor profile & complexity ratings for ${activeRecipe.name}.`, 'success');
  };

  // Reset local state to computed defaults
  const handleResetToDefaults = () => {
    if (!activeRecipe) return;
    const defaultFlavor = getSmartDefaultFlavor(activeRecipe);
    const defaultComp = getSmartDefaultComplexity(activeRecipe);

    setSweet(defaultFlavor.sweet);
    setSour(defaultFlavor.sour);
    setBitter(defaultFlavor.bitter);
    setBoozy(defaultFlavor.boozy);
    setSpicy(defaultFlavor.spicy);
    setHerbal(defaultFlavor.herbal);

    setComplexityScore(defaultComp.score);
    setComplexityText(defaultComp.text);
    setHasUnsavedChanges(true); // Treat as changed compared to saved record
  };

  // Handle segmented slider click for complexity Level score
  const changeComplexity = (score: number) => {
    setComplexityScore(score);
    let text = 'Medium';
    if (score <= 2) text = 'Simple';
    else if (score >= 4) text = 'Complex';
    setComplexityText(text);
    setHasUnsavedChanges(true);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[#111111] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6 relative overflow-hidden backdrop-blur-xl"
    >
      {/* Decorative ambient background accent */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-orange-600/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
      
      {/* Header section with quick picker */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-5">
        <div className="space-y-1">
          <h3 className="text-sm font-black uppercase text-orange-500 tracking-wider flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" />
            Flavor Profile & Complexity Spec Analyzer
          </h3>
          <p className="text-[10px] text-gray-500 font-semibold uppercase">
            Map flavor dynamics, craft techniques, and standard ingredients into bartender charts.
          </p>
        </div>

        {/* Dropdown picker */}
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider font-mono">Select Recipe:</span>
          <select 
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-black border border-white/10 text-white rounded-xl py-1.5 px-3 text-xs font-bold outline-none focus:border-orange-500 max-w-xs transition-all cursor-pointer"
          >
            {recipes.map(r => (
              <option key={r.id} value={r.id}>
                {r.name} ({String(r.category)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main interactive grid splitting controls & recharts Radar */}
      <div className="grid lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Ingredients & Complexity Spec card (4 columns) */}
        <div className="lg:col-span-4 bg-black/40 border border-white/[0.03] p-5 rounded-2xl flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-black uppercase text-gray-400 tracking-widest font-mono">Specs Card</span>
              <span className="text-[9px] font-black uppercase text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full">
                {activeRecipe.category}
              </span>
            </div>

            <div className="space-y-1">
              <h4 className="text-lg font-black text-white uppercase tracking-tight">{activeRecipe.name}</h4>
              <p className="text-[9px] text-gray-500 leading-tight italic line-clamp-2">"{activeRecipe.instructions}"</p>
            </div>

            {/* Ingredients sub-list */}
            <div className="space-y-2 pt-2">
              <span className="text-[8.5px] font-bold text-gray-400 uppercase block tracking-wider">Required Ingredients</span>
              <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                {activeRecipe.ingredients.map((ing, idx) => (
                  <div key={idx} className="flex justify-between items-center text-xs bg-black/50 border border-white/[0.02] px-3 py-2 rounded-xl">
                    <span className="text-gray-300 font-bold max-w-[70%] truncate">{ing.item}</span>
                    <span className="text-orange-400/80 font-mono text-[10.5px] font-extrabold italic select-none">{ing.amount}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Complexity Spec selector */}
          <div className="space-y-3 pt-3 border-t border-white/5 font-sans">
            <div className="flex justify-between items-baseline">
              <span className="text-[8.5px] font-black text-gray-400 uppercase tracking-wide">Preparation Complexity</span>
              <span className={`text-[10px] font-black uppercase ${
                complexityScore <= 2 ? 'text-green-400' : complexityScore === 3 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {complexityText} (Level {complexityScore}/5)
              </span>
            </div>

            {/* Interactive Selector Node */}
            <div className="flex items-center gap-1.5 pt-0.5">
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  type="button"
                  key={level}
                  onClick={() => changeComplexity(level)}
                  className={`flex-1 h-5 rounded-lg border transition-all text-[10px] font-black flex items-center justify-center cursor-pointer ${
                    level <= complexityScore
                      ? level <= 2
                        ? 'bg-green-600/20 border-green-500/40 text-green-400'
                        : level === 3
                        ? 'bg-amber-600/20 border-amber-500/40 text-amber-400'
                        : 'bg-red-600/20 border-red-500/40 text-red-500'
                      : 'bg-[#151515] hover:bg-[#202020] border-white/5 text-gray-600 hover:text-gray-400'
                  }`}
                  title={`Set selection to level ${level}`}
                >
                  {level}
                </button>
              ))}
            </div>
            
            {/* Context help note */}
            <p className="text-[8px] text-gray-600 font-medium leading-relaxed uppercase">
              {complexityScore <= 2 
                ? '★ FAST SERVICE-FRIENDLY: Can be compiled and served within 60 seconds.' 
                : complexityScore === 3 
                ? '★★ STANDARD POUR SPEC: Involves shaking, stirring, or moderate double strained glassware setup.' 
                : '★★★ ARTISANAL MIXOLOGY: Requires premium muddling, smoking, flame garnish, or layered densities.'}
            </p>
          </div>
        </div>

        {/* Dynamic Sliders to adjust Profile values (4 columns) */}
        <div className="lg:col-span-4 bg-black/20 border border-white/[0.02] p-5 rounded-2xl flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-white/5">
              <span className="text-[9px] font-black uppercase text-gray-400 tracking-widest font-mono">Flavor Tuning Engine</span>
              <span className="text-[8.5px] text-gray-500 font-bold uppercase">Values 0 - 10</span>
            </div>

            {/* Sliders bundle */}
            <div className="space-y-3">
              {[
                { label: 'Sweet 🍬', val: sweet, setter: setSweet },
                { label: 'Sour 🍋', val: sour, setter: setSour },
                { label: 'Bitter 🪵', val: bitter, setter: setBitter },
                { label: 'Boozy (Strength) 🥃', val: boozy, setter: setBoozy },
                { label: 'Spicy 🔥', val: spicy, setter: setSpicy },
                { label: 'Herbal (Botanical) 🌿', val: herbal, setter: setHerbal }
              ].map((sliderObj, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold text-gray-300 font-mono">
                    <span>{sliderObj.label}</span>
                    <span className="text-orange-400 font-extrabold">{sliderObj.val}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={sliderObj.val}
                    onChange={(e) => {
                      sliderObj.setter(parseInt(e.target.value));
                      setHasUnsavedChanges(true);
                    }}
                    className="w-full accent-orange-600 h-1 bg-white/5 hover:bg-white/10 rounded-lg cursor-pointer transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-2 pt-3 border-t border-white/5 font-sans">
            <button
              onClick={handleResetToDefaults}
              className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 text-gray-400 hover:text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              title="Reset profile dimensions to algorithm calculated system guesses"
            >
              <RotateCcw className="w-3 h-3 text-orange-400" />
              Auto Guess
            </button>
            
            <button
              onClick={handleSaveProfile}
              className={`flex-1 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                hasUnsavedChanges 
                  ? 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white shadow-lg shadow-orange-600/10'
                  : 'bg-black/40 border border-[#333] hover:border-white/10 text-gray-500 hover:text-gray-300'
              }`}
            >
              <Save className={`w-3 h-3 ${hasUnsavedChanges ? 'text-white' : 'text-gray-400'}`} />
              {hasUnsavedChanges ? 'Save Changes' : 'Profile Synced'}
            </button>
          </div>
        </div>

        {/* recharts Radar Map Frame (4 columns) */}
        <div className="lg:col-span-4 bg-black/50 border border-white/[0.03] p-5 rounded-2xl flex flex-col items-center justify-center min-h-[320px] relative">
          <span className="absolute top-4 left-4 text-[9px] font-black uppercase text-gray-400 tracking-widest font-mono">Radar Analysis Map</span>
          
          <div className="w-full h-full max-h-[300px] flex items-center justify-center overflow-hidden">
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
                <PolarGrid stroke="#333333" strokeWidth={1} />
                <PolarAngleAxis 
                  dataKey="name" 
                  tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 700 }} 
                />
                <PolarRadiusAxis 
                  angle={30} 
                  domain={[0, 10]} 
                  tick={{ fill: '#4b5563', fontSize: 8 }}
                  axisLine={false}
                />
                <Radar
                  name={activeRecipe.name}
                  dataKey="value"
                  stroke="#ea580c"
                  fill="#f97316"
                  fillOpacity={0.35}
                />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-[#181818] border border-white/10 px-2.5 py-1.5 rounded-xl shadow-xl font-mono text-[10px]">
                          <span className="font-bold text-white uppercase">{String(payload[0].name)}:</span>{' '}
                          <span className="text-orange-400 font-black">{String(payload[0].value)}/10</span>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center gap-1.5 text-[8.5px] font-black text-gray-500 uppercase tracking-widest pt-2">
            <div className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
            Live Spec Visualization Model
          </div>
        </div>

      </div>
    </motion.div>
  );
};
