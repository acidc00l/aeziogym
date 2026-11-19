import json, re

print("🚀 Iniciando traducción precisa del dataset maestro...")

with open('scripts/exercises.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Diccionario de combinaciones exactas y técnicas de gimnasio
EXACT_TRANSLATIONS = {
    "archer pull-up": "Dominadas arqueras",
    "archer push-up": "Flexiones arqueras",
    "ring dip": "Fondos en anillas",
    "bar dip": "Fondos en barra",
    "chest dip": "Fondos para pecho",
    "triceps dip": "Fondos para tríceps",
    "skullcrusher": "Press francés (Skullcrusher)",
    "preacher curl": "Curl predicador",
    "hammer curl": "Curl martillo",
    "concentration curl": "Curl concentrado",
    "arnold press": "Press Arnold",
    "pallof press": "Press Pallof",
    "face pull": "Face pull en polea",
    "lat pulldown": "Jalón al pecho",
    "romanian deadlift": "Peso muerto rumano",
    "stiff leg deadlift": "Peso muerto piernas rígidas",
    "sumo deadlift": "Peso muerto sumo",
    "goblet squat": "Sentadilla Goblet",
    "bulgarian split squat": "Sentadilla búlgara",
    "pistol squat": "Sentadilla pistol (a una pierna)",
    "sissy squat": "Sentadilla Sissy",
    "hyperextension": "Hiperextensiones lumbares",
    "reverse fly": "Aperturas invertidas (Pájaro)",
    "wrist roller": "Rodillo de muñeca"
}

# Modificadores de equipamiento y posición
MODIFIERS = {
    "dumbbell": "con mancuerna",
    "dumbbells": "con mancuernas",
    "barbell": "con barra",
    "cable": "en polea",
    "kettlebell": "con pesa rusa",
    "band": "con banda de resistencia",
    "lever": "en máquina de palanca",
    "smith": "en máquina Smith",
    "seated": "sentado",
    "standing": "de pie",
    "lying": "tumbado",
    "incline": "inclinado",
    "decline": "declinado",
    "close grip": "agarre estrecho",
    "wide grip": "agarre ancho",
    "reverse grip": "agarre invertido",
    "one arm": "a una mano",
    "single arm": "a una mano",
    "one leg": "a una pierna",
    "single leg": "a una pierna"
}

# Núcleos de movimiento
BASE_ACTIONS = [
    ("bench press", "Press de banca"),
    ("chest press", "Press de pecho"),
    ("shoulder press", "Press de hombros"),
    ("overhead press", "Press militar"),
    ("press", "Press"),
    ("squat", "Sentadilla"),
    ("deadlift", "Peso muerto"),
    ("push-up", "Flexiones"),
    ("push up", "Flexiones"),
    ("pull-up", "Dominadas"),
    ("pull up", "Dominadas"),
    ("chin-up", "Dominadas supinas"),
    ("curl", "Curl"),
    ("fly", "Aperturas"),
    ("row", "Remo"),
    ("dip", "Fondos"),
    ("raise", "Elevaciones"),
    ("extension", "Extensiones"),
    ("crunch", "Encogimientos abdominales"),
    ("sit-up", "Abdominales sit-up"),
    ("shrug", "Encogimiento de hombros"),
    ("calf raise", "Elevación de gemelos")
]

def translate_name(eng_name):
    clean = eng_name.lower().strip()
    
    # 1. Caso exacto
    if clean in EXACT_TRANSLATIONS:
        return EXACT_TRANSLATIONS[clean]
    
    # 2. Buscar si contiene un término exacto completo
    for k, v in EXACT_TRANSLATIONS.items():
        if k in clean:
            # Extraer si es sentado, inclinado, etc.
            extra_mods = [MODIFIERS[m] for m in MODIFIERS if m in clean and MODIFIERS[m] not in v.lower()]
            if extra_mods:
                return f"{v} {' '.join(extra_mods)}".strip()
            return v

    # 3. Construcción estructurada: Acción + Modificadores
    base_action_es = None
    matched_key = None
    for key_eng, action_es in BASE_ACTIONS:
        if key_eng in clean:
            base_action_es = action_es
            matched_key = key_eng
            break

    if base_action_es:
        # Detectar modificadores
        found_mods = []
        for mod_eng, mod_es in MODIFIERS.items():
            if mod_eng in clean and mod_eng != matched_key:
                found_mods.append(mod_es)
        
        # Ensamblar frase fluida
        if found_mods:
            return f"{base_action_es} {' '.join(found_mods)}"
        return base_action_es

    # Fallback limpio si no entra en reglas
    return eng_name.capitalize()

translated_count = 0
for ex in data:
    orig_name = ex.get('name', '')
    translated = translate_name(orig_name)
    ex['name_es'] = translated
    if translated != orig_name:
        translated_count += 1

with open('scripts/exercises_es.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"🎉 ¡Completado! Se generó 'scripts/exercises_es.json' con {len(data)} ejercicios ({translated_count} traducidos correctamente).")
