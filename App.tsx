import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as Notifications from 'expo-notifications';
import { DataStore, User } from './data';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { Feather } from '@expo/vector-icons';
import { signInWithGoogle } from './googleAuth';

WebBrowser.maybeCompleteAuthSession();

type ItemType = 'receipt' | 'coupon' | 'warranty';
type Item = { id: number; entity: string; type: ItemType; amount: number; deadline: string; estimated: boolean; offer?: string };
type Flow = 'onboarding' | 'auth' | 'home';
type Tab = 'home' | 'vault' | 'profile';

const today = new Date();
today.setHours(12, 0, 0, 0);
const day = 86_400_000;
const plusDays = (days: number) => new Date(today.getTime() + days * day).toISOString().slice(0, 10);
const daysUntil = (value: string) => Math.max(0, Math.ceil((new Date(`${value}T12:00:00`).getTime() - today.getTime()) / day));
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dateLong = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const typeName = (type: ItemType) => type === 'receipt' ? 'Return' : type === 'coupon' ? 'Deal' : 'Warranty';
const itemMark = (type: ItemType) => type === 'coupon' ? '%' : type === 'warranty' ? 'OK' : 'R';
const timeLabel = (days: number) => days === 0 ? 'Today' : days === 1 ? '1 day left' : `${days} days left`;

const initialItems: Item[] = [
  { id: 1, entity: 'Amazon', type: 'receipt', amount: 42.5, deadline: plusDays(2), estimated: true },
  { id: 2, entity: 'Target', type: 'coupon', amount: 20, deadline: plusDays(5), estimated: false, offer: '20% off entire purchase' },
  { id: 3, entity: 'Best Buy', type: 'receipt', amount: 119.99, deadline: plusDays(14), estimated: true },
  { id: 4, entity: 'Patagonia', type: 'warranty', amount: 0, deadline: plusDays(86), estimated: false },
];

const genAI = new GoogleGenerativeAI('AIzaSyBo_cbYe0PyErj-aPoYEX6bD1AeORS1fzk');

function decodeBase64(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  
  const buffer = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let idx = 0; idx < chars.length; idx++) {
    lookup[chars.charCodeAt(idx)] = idx;
  }

  for (let idx = 0; idx < base64.length; idx += 4) {
    const code0 = base64.charCodeAt(idx);
    const code1 = base64.charCodeAt(idx + 1);
    const code2 = base64.charCodeAt(idx + 2);
    const code3 = base64.charCodeAt(idx + 3);

    if (code0 === 61 || isNaN(code0)) break; // '='

    const val0 = lookup[code0];
    const val1 = lookup[code1];
    const val2 = code2 === 61 ? 0 : lookup[code2];
    const val3 = code3 === 61 ? 0 : lookup[code3];

    buffer.push((val0 << 2) | (val1 >> 4));
    if (code2 !== 61) {
      buffer.push(((val1 & 15) << 4) | (val2 >> 2));
      if (code3 !== 61) {
        buffer.push(((val2 & 3) << 6) | val3);
      }
    }
  }

  // Decode buffer as UTF-8 string
  let out = "";
  let idx = 0;
  while (idx < buffer.length) {
    const c = buffer[idx++];
    if (c < 128) {
      out += String.fromCharCode(c);
    } else if (c > 191 && c < 224) {
      out += String.fromCharCode(((c & 31) << 6) | (buffer[idx++] & 63));
    } else if (c > 223 && c < 240) {
      out += String.fromCharCode(((c & 15) << 12) | ((buffer[idx++] & 63) << 6) | (buffer[idx++] & 63));
    }
  }
  return out;
}

export interface GmailEmail {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  fullBody: string;
}

export async function fetchRecentReceiptEmails(accessToken: string): Promise<GmailEmail[]> {
  try {
    const query = encodeURIComponent('subject:receipt OR subject:order OR subject:invoice OR subject:confirmation OR subject:warranty OR subject:coupon OR paypal');
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    if (!listRes.ok) {
      throw new Error(`Gmail API returned status ${listRes.status}`);
    }
    
    const listData = await listRes.json();
    if (!listData.messages || listData.messages.length === 0) {
      return [];
    }
    
    const emailPromises = listData.messages.map(async (msg: any) => {
      try {
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!msgRes.ok) return null;
        const msgData = await msgRes.json();
        
        const headers = msgData.payload.headers || [];
        const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || 'No Subject';
        const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
        const date = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || '';
        
        const extractBody = (part: any): string => {
          if (part.body && part.body.data) {
            return decodeBase64(part.body.data);
          }
          if (part.parts) {
            return part.parts.map(extractBody).join('\n');
          }
          return '';
        };

        const fullBody = extractBody(msgData.payload);
        
        return {
          id: msg.id,
          subject,
          from,
          date,
          snippet: msgData.snippet || '',
          fullBody: fullBody || msgData.snippet || '',
        };
      } catch (err) {
        console.warn('Failed to parse email message:', msg.id, err);
        return null;
      }
    });
    
    const emails = await Promise.all(emailPromises);
    return emails.filter((e): e is GmailEmail => e !== null);
  } catch (e) {
    console.error('fetchRecentReceiptEmails error:', e);
    throw e;
  }
}

interface IngestionInput { source: 'photo' | 'text'; payload: string; mimeType?: string; }
interface IngestionResult { entity: string; type: ItemType; amount: string; deadline: string; estimated: boolean; offer?: string; }

const simulateIngestion = async (input: IngestionInput): Promise<IngestionResult> => {
  const models = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash", "models/gemini-1.5-flash"];
  let lastError = null;

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const prompt = `Analyze this input and extract details for a receipt, coupon, or warranty app. Return ONLY valid JSON in this exact format: {"entity": "Store Name", "type": "receipt" | "coupon" | "warranty", "amount": "12.34" (just numbers or empty string if not applicable), "deadline": "YYYY-MM-DD" (calculate based on today's date if relative, like 30 days from now, today is ${new Date().toISOString().slice(0,10)}), "estimated": boolean}. Be accurate. If deadline is unstated, estimate 30 days and set estimated true.`;

      let result;
      if (input.source === 'photo') {
        result = await model.generateContent([
          prompt,
          { inlineData: { data: input.payload, mimeType: input.mimeType || "image/jpeg" } }
        ]);
      } else {
        result = await model.generateContent([prompt, "Text to analyze: " + input.payload]);
      }

      const responseText = result.response.text();
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return {
          entity: data.entity || 'Unknown Store',
          type: data.type || 'receipt',
          amount: data.amount || '',
          deadline: data.deadline || plusDays(30),
          estimated: !!data.estimated
        };
      }
    } catch (e: any) {
      console.warn(`Model ${modelName} failed:`, e.message || e);
      lastError = e;
    }
  }

  console.error("All Gemini models failed. Last error:", lastError);
  
  // Fallback to offline parsing if no models work or if API key fails
  const text = input.payload.toLowerCase();
  const result: IngestionResult = { entity: 'Unknown Store', type: 'receipt', amount: '', deadline: plusDays(30), estimated: true };
  if (text.includes('amazon')) result.entity = 'Amazon';
  else if (text.includes('best buy')) result.entity = 'Best Buy';
  else if (text.includes('nike')) result.entity = 'Nike';
  else if (text.includes('target')) result.entity = 'Target';
  else if (text.trim() && input.source === 'text') result.entity = text.trim().split(' ')[0].replace(/^./, (c: string) => c.toUpperCase());

  if (text.includes('coupon') || text.includes('deal') || text.includes('off') || text.includes('promo')) result.type = 'coupon';
  else if (text.includes('warranty') || text.includes('guarantee')) result.type = 'warranty';

  const amt = text.match(/\$([0-9]+\.[0-9]{2})/);
  if (amt) result.amount = amt[1];
  return result;
};

const slides = [
  { count: '01', title: 'A better place for the things you might lose.', body: 'Receipts, returns, deals, and warranties. Finally all in one spot.', card: 'receipt' },
  { count: '02', title: 'Your money has a memory now.', body: 'Holdr spots the important date, then gives it a nudge before it is too late.', card: 'deadline' },
  { count: '03', title: 'Save it once. Stop thinking about it.', body: 'Snap a photo, forward an email, and get back to your day.', card: 'done' },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <HoldrApp />
    </SafeAreaProvider>
  );
}

function HoldrApp() {
  const [flow, setFlow] = useState<Flow>('onboarding');
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [authMode, setAuthMode] = useState<'signup' | 'signin'>('signup');
  const [tab, setTab] = useState<Tab>('home');
  const [userName, setUserName] = useState('Alex');
  const [items, setItems] = useState<Item[]>(initialItems);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerOptions, setComposerOptions] = useState<{ step?: 'choose' | 'paste' | 'processing' | 'edit'; type?: ItemType; autoLaunchPhoto?: boolean }>({});
  const [selected, setSelected] = useState<Item | null>(null);
  const [notice, setNotice] = useState('');
  const [entity, setEntity] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<ItemType>('receipt');
  const [deadline, setDeadline] = useState(plusDays(30));
  const [estimated, setEstimated] = useState(true);
  const [googleToken, setGoogleToken] = useState<string | null>(null);

  const heroFloat = useRef(new Animated.Value(0)).current;
  const screenEntrance = useRef(new Animated.Value(0)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (flow !== 'onboarding') return;
    heroFloat.setValue(0);
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(heroFloat, { toValue: 1, duration: 2500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(heroFloat, { toValue: 0, duration: 2500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [flow, heroFloat]);

  // Check if user is logged in, and load items if so on boot!
  useEffect(() => {
    const checkUserAndLoad = async () => {
      try {
        await Notifications.requestPermissionsAsync();
        const savedUser = await DataStore.getUser();
        if (savedUser) {
          setUserName(savedUser.name);
          const savedToken = await AsyncStorage.getItem('@holdr_google_token');
          if (savedToken) {
            setGoogleToken(savedToken);
          }
          // Test Mode requested: Blank empty account each time
          setItems([]);
          setFlow('home');
          setTab('home');
        }
      } catch (e) {
        console.error('Failed to load user or items:', e);
      }
    };
    checkUserAndLoad();
  }, []);

  useEffect(() => {
    screenEntrance.setValue(0);
    Animated.spring(screenEntrance, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }).start();
  }, [flow, tab, screenEntrance]);

  const sortedItems = useMemo(() => [...items].sort((a, b) => a.deadline.localeCompare(b.deadline)), [items]);
  const risk = items.filter(item => daysUntil(item.deadline) <= 7).reduce((total, item) => total + item.amount, 0);

  const showNotice = (message: string) => {
    setNotice(message);
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1700),
      Animated.timing(toastOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setNotice(''));
  };

  const finishOnboarding = () => setFlow('auth');
  const nextOnboardingStep = () => onboardingStep === slides.length - 1 ? finishOnboarding() : setOnboardingStep(step => step + 1);
  
  const authenticate = async (user?: import('./data').User, accessToken?: string) => {
    if (user) {
      try {
        await DataStore.saveUser(user);
        setUserName(user.name);
        if (accessToken) {
          setGoogleToken(accessToken);
          await AsyncStorage.setItem('@holdr_google_token', accessToken);
        }
        
        // Test Mode requested: Blank empty account each time
        setItems([]);
      } catch (e) {
        console.error('Failed to save user or load items:', e);
        Alert.alert('Database Connection Failed', 'Could not save user session, but proceeding in guest mode...');
        setUserName(user.name);
        setItems(initialItems);
      }
    }
    setFlow('home');
    setTab('home');
    showNotice('You are all set. Welcome to Holdr.');
  };

  const openComposer = (options?: { step?: 'choose' | 'paste' | 'processing' | 'edit'; type?: ItemType; autoLaunchPhoto?: boolean }) => {
    setEntity('');
    setAmount('');
    setType(options?.type || 'receipt');
    setDeadline(plusDays(30));
    setEstimated(true);
    setComposerOptions(options || {});
    setComposerOpen(true);
  };

  const addItem = async () => {
    if (!entity.trim()) return Alert.alert('Add a store or brand', 'For example: Amazon, Target, or Nike.');
    try {
      const rawAmt = Number(amount.replace(/[^0-9.]/g, '')) || 0;
      const newItem = await DataStore.addItem({
        entity: entity.trim(),
        amount: rawAmt,
        type,
        deadline,
        estimated,
      });
      setItems(current => [...current, newItem]);
      setComposerOpen(false);
      showNotice(`${entity.trim()} is safe in your Holdr.`);
    } catch (e) {
      console.error('Failed to add item to database:', e);
      // Robust fallback
      const fallbackItem = { id: Date.now(), entity: entity.trim(), amount: Number(amount.replace(/[^0-9.]/g, '')) || 0, type, deadline, estimated };
      setItems(current => [...current, fallbackItem]);
      setComposerOpen(false);
      showNotice(`${entity.trim()} added locally (offline mode).`);
    }
  };

  const adjustDeadline = async (days: number) => {
    if (!selected) return;
    try {
      const newDeadline = plusDays(days);
      await DataStore.updateItem(selected.id, { deadline: newDeadline, estimated: false });
      setItems(current => current.map(item => item.id === selected.id ? { ...item, deadline: newDeadline, estimated: false } : item));
      setSelected(null);
      showNotice('Deadline updated. We will keep watch.');
    } catch (e) {
      console.error('Failed to update item deadline:', e);
      const newDeadline = plusDays(days);
      setItems(current => current.map(item => item.id === selected.id ? { ...item, deadline: newDeadline, estimated: false } : item));
      setSelected(null);
      showNotice('Deadline updated locally.');
    }
  };

  const markUsed = async () => {
    if (!selected) return;
    try {
      await DataStore.deleteItem(selected.id);
      setItems(current => current.filter(item => item.id !== selected.id));
      setSelected(null);
      showNotice('Done. One less thing to hold onto.');
    } catch (e) {
      console.error('Failed to delete item:', e);
      setItems(current => current.filter(item => item.id !== selected.id));
      setSelected(null);
      showNotice('Removed locally.');
    }
  };

  const handleLogOut = async () => {
    try {
      await DataStore.removeUser();
      await AsyncStorage.removeItem('@holdr_google_token');
      setGoogleToken(null);
      setUserName('Alex');
      setItems(initialItems);
      setFlow('auth');
    } catch (e) {
      console.error('Logout error:', e);
      setFlow('auth');
    }
  };

  if (flow === 'onboarding') return <Onboarding step={onboardingStep} floatValue={heroFloat} onNext={nextOnboardingStep} onSkip={finishOnboarding} />;
  if (flow === 'auth') return <AuthScreen mode={authMode} setMode={setAuthMode} onBack={() => setFlow('onboarding')} onSuccess={authenticate} />;

  const enterStyle = { opacity: screenEntrance, transform: [{ translateY: screenEntrance.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] };
  return <View style={styles.safe}>
    <StatusBar style="dark" />
    <View style={styles.app}>
      <Animated.View style={[styles.page, enterStyle]}>
        {tab === 'home' && <HomeView name={userName} items={sortedItems} risk={risk} onItemPress={setSelected} onAdd={openComposer} />}
        {tab === 'vault' && <VaultView items={sortedItems} onItemPress={setSelected} onAdd={openComposer} />}
        {tab === 'profile' && <ProfileView name={userName} itemCount={items.length} onLogOut={handleLogOut} />}
      </Animated.View>
      <BottomTabs active={tab} onChange={setTab} onAdd={openComposer} />
    </View>
    {notice ? <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toastOpacity }]}><Text style={styles.toastText}>{notice}</Text></Animated.View> : null}
    <Composer open={composerOpen} onClose={() => setComposerOpen(false)} entity={entity} setEntity={setEntity} amount={amount} setAmount={setAmount} type={type} setType={setType} deadline={deadline} setDeadline={setDeadline} estimated={estimated} setEstimated={setEstimated} onAdd={addItem} initialStep={composerOptions.step} autoLaunchPhoto={composerOptions.autoLaunchPhoto} googleToken={googleToken} />
    <DetailSheet item={selected} onClose={() => setSelected(null)} onAdjust={adjustDeadline} onMarkUsed={markUsed} />
  </View>;
}

const AnimatedPressableComponent = Animated.createAnimatedComponent(Pressable);

function AnimatedPressable({ children, style, onPress, ...props }: any) {
  const scale = useRef(new Animated.Value(1)).current;
  const animateIn = () => Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, speed: 20, bounciness: 10 }).start();
  const animateOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 10 }).start();
  return (
    <AnimatedPressableComponent onPressIn={animateIn} onPressOut={animateOut} onPress={onPress} style={[style, { transform: [{ scale }] }]} {...props}>
      {children}
    </AnimatedPressableComponent>
  );
}

type AnimationType = 'bounce' | 'wobble' | 'spin' | 'pop';

interface AnimatedIconProps {
  name: keyof typeof Feather.glyphMap;
  size: number;
  color: string;
  style?: any;
  animationTrigger?: number;
  animationType?: AnimationType;
}

function AnimatedFeatherIcon({ name, size, color, style, animationTrigger, animationType = 'pop' }: AnimatedIconProps) {
  const scaleValue = useRef(new Animated.Value(1)).current;
  const translateValue = useRef(new Animated.Value(0)).current;
  const rotateValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (animationTrigger === 0 || animationTrigger === undefined) return;

    if (animationType === 'bounce') {
      translateValue.setValue(-8);
      Animated.spring(translateValue, {
        toValue: 0,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }).start();
    } else if (animationType === 'wobble') {
      rotateValue.setValue(-1);
      Animated.spring(rotateValue, {
        toValue: 0,
        friction: 3,
        tension: 30,
        useNativeDriver: true,
      }).start();
    } else if (animationType === 'spin') {
      rotateValue.setValue(0);
      Animated.timing(rotateValue, {
        toValue: 1,
        duration: 450,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (animationType === 'pop') {
      scaleValue.setValue(1.3);
      Animated.spring(scaleValue, {
        toValue: 1,
        friction: 4,
        tension: 50,
        useNativeDriver: true,
      }).start();
    }
  }, [animationTrigger, animationType]);

  const rotateWobble = rotateValue.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-20deg', '20deg'],
  });

  const rotateSpin = rotateValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const transform = [];
  if (animationType === 'bounce') {
    transform.push({ translateY: translateValue });
  } else if (animationType === 'wobble') {
    transform.push({ rotate: rotateWobble });
  } else if (animationType === 'spin') {
    transform.push({ rotate: rotateSpin });
  } else if (animationType === 'pop') {
    transform.push({ scale: scaleValue });
  }

  return (
    <Animated.View style={[style, { transform }]}>
      <Feather name={name} size={size} color={color} />
    </Animated.View>
  );
}


function AnimatedListItem({ children, index, delay = 60 }: { children: React.ReactNode; index: number; delay?: number }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    setTimeout(() => {
      Animated.spring(enter, { toValue: 1, friction: 8, tension: 50, useNativeDriver: true }).start();
    }, index * delay);
  }, [enter, index, delay]);
  return <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [25, 0] }) }] }}>{children}</Animated.View>;
}

function Onboarding({ step, floatValue, onNext, onSkip }: { step: number; floatValue: Animated.Value; onNext: () => void; onSkip: () => void }) {
  const slide = slides[step];
  if (!slide) return null;
  const translateY = floatValue.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

  const fade = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(15)).current;

  useEffect(() => {
    fade.setValue(0);
    slideY.setValue(20);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideY, { toValue: 0, friction: 7, tension: 40, useNativeDriver: true })
    ]).start();
  }, [step, fade, slideY]);

  const handleNext = () => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideY, { toValue: -15, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true })
    ]).start(() => onNext());
  };

  const handleSkip = () => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideY, { toValue: -15, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true })
    ]).start(() => onSkip());
  };

  return <SafeAreaView style={styles.onboardingSafe}>
    <StatusBar style="dark" />
    <View style={styles.onboarding}>
      <View style={styles.onboardingTop}><Text style={styles.wordmark}>holdr<Text style={styles.coral}>.</Text></Text><Pressable onPress={handleSkip}><Text style={styles.skip}>Skip</Text></Pressable></View>
      <View style={styles.onboardingMiddle}>
        <View style={styles.blobOne} /><View style={styles.blobTwo} />
        <Animated.View style={[styles.storyCard, { opacity: fade, transform: [{ translateY: Animated.add(translateY, slideY) }] }]}>{slide.card === 'receipt' && <ReceiptStory />}{slide.card === 'deadline' && <DeadlineStory />}{slide.card === 'done' && <DoneStory />}</Animated.View>
      </View>
      <View style={styles.onboardingBottom}>
        <Animated.View style={{ opacity: fade, transform: [{ translateY: slideY }] }}>
          <Text style={styles.slideCount}>{slide.count} / 03</Text>
          <Text style={styles.onboardingTitle}>{slide.title}</Text>
          <Text style={styles.onboardingBody}>{slide.body}</Text>
        </Animated.View>
        <View style={styles.progress}>{slides.map((_, index) => <View key={index} style={[styles.progressLine, index === step && styles.progressLineActive]} />)}</View>
        <Pressable style={styles.darkButton} onPress={handleNext}><Text style={styles.darkButtonText}>{step === 2 ? 'Start holding' : 'Continue'}</Text><Text style={styles.buttonArrow}>{'>'}</Text></Pressable>
      </View>
    </View>
  </SafeAreaView>;
}

function ReceiptStory() {
  return <View style={styles.receiptStory}><View style={styles.storyHeader}><Text style={styles.storyBrand}>NORTH MARKET</Text><Text style={styles.storyDate}>JUST NOW</Text></View><View style={styles.dash} /><Text style={styles.storyItem}>Everyday Sneakers</Text><Text style={styles.storyAmount}>$84.00</Text><View style={styles.storyDeadline}><Text style={styles.storyDeadlineLabel}>RETURN BY</Text><Text style={styles.storyDeadlineDate}>AUG 12</Text></View><View style={styles.storyFooter}><Text style={styles.storyFooterText}>Saved to your Holdr</Text><Text style={styles.storyFooterMark}>+</Text></View></View>;
}

function DeadlineStory() {
  return <View style={styles.deadlineStory}><Text style={styles.deadlineKicker}>YOUR NEXT DEADLINE</Text><Text style={styles.deadlineBig}>2<Text style={styles.deadlineUnit}> days</Text></Text><View style={styles.deadlineBar}><View style={styles.deadlineBarFill} /></View><View style={styles.deadlineItem}><View style={styles.deadlineIcon}><Text style={styles.deadlineIconText}>R</Text></View><View><Text style={styles.deadlineItemName}>Amazon return</Text><Text style={styles.deadlineItemMeta}>$42.50 to get back</Text></View></View><Text style={styles.deadlinePrompt}>We will nudge you in time.</Text></View>;
}

function DoneStory() {
  return <View style={styles.doneStory}><View style={styles.doneCheck}><Text style={styles.doneCheckText}>OK</Text></View><Text style={styles.doneTitle}>Held onto it.</Text><Text style={styles.doneBody}>The deal is safe. The reminder is set.</Text><View style={styles.doneRow}><Text style={styles.doneBrand}>TARGET</Text><Text style={styles.donePill}>20% OFF</Text></View></View>;
}

function AuthScreen({ mode, setMode, onBack, onSuccess }: { mode: 'signup' | 'signin'; setMode: (mode: 'signup' | 'signin') => void; onBack: () => void; onSuccess: (user: import('./data').User, accessToken?: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signingUp = mode === 'signup';
  
  const submit = async () => {
    if (!email.includes('@') || password.length < 4 || (signingUp && !name.trim())) {
      return Alert.alert('Almost there', 'Enter your name, a valid email, and a password with at least 4 characters.');
    }
    
    try {
      if (signingUp) {
        // Create user and save to Turso via DataStore
        const newUser = { id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(), name: name.trim(), email: email.toLowerCase() };
        await DataStore.saveUser(newUser);
        onSuccess(newUser);
      } else {
        // Actually check Turso for this email
        const res = await fetch(process.env.EXPO_PUBLIC_TURSO_DATABASE_URL!.replace('libsql://', 'https://'), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.EXPO_PUBLIC_TURSO_AUTH_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            requests: [{ type: 'execute', stmt: { sql: 'SELECT * FROM users WHERE email = ?', args: [{ type: 'text', value: email.toLowerCase() }] } }]
          })
        }).then(r => r.json());

        const rows = res?.results?.[0]?.response?.result?.rows || [];
        if (rows.length === 0) {
          return Alert.alert('Error', 'No account found with that email address.');
        }
        
        // Pass the user from the database
        onSuccess({ id: rows[0][0].value, name: rows[0][1].value, email: rows[0][2].value });
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Could not connect to the database.');
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const result = await signInWithGoogle();
      if (result && result.user) {
        onSuccess(result.user, result.accessToken);
      }
    } catch (e) {
      // Error handling is managed inside signInWithGoogle
    }
  };

  const handleBypass = () => {
    // Instantly bypass login with a dummy user
    onSuccess({ id: 'bypass-123', name: 'Tester', email: 'test@example.com' });
  };

  return <SafeAreaView style={styles.authSafe}><StatusBar style="dark" />
    <KeyboardAvoidingView style={styles.authKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.authTop}><Pressable style={styles.backButton} onPress={onBack}><Text style={styles.backText}>{'< Back'}</Text></Pressable><Text style={styles.wordmark}>holdr<Text style={styles.coral}>.</Text></Text></View>
        <View style={styles.authVisual}><View style={styles.authVisualSquare}><Text style={styles.authVisualSmall}>YOUR</Text><Text style={styles.authVisualBig}>$</Text><Text style={styles.authVisualSmall}>SAFE PLACE</Text></View><View style={styles.authVisualTag}><Text style={styles.authVisualTagText}>KEEP MORE</Text></View></View>
        <Text style={styles.authTitle}>{signingUp ? 'Start keeping more.' : 'Welcome back.'}</Text>
        <Text style={styles.authBody}>{signingUp ? 'Make a tiny home for every deadline worth remembering.' : 'Your receipts, deals, and deadlines are right where you left them.'}</Text>
        <View style={styles.authForm}>
          {signingUp && <Input label="First name" value={name} onChangeText={setName} placeholder="Alex" />}
          <Input label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
          <Input label="Password" value={password} onChangeText={setPassword} placeholder="At least 4 characters" secureTextEntry />
          <Pressable style={styles.limeButton} onPress={submit}><Text style={styles.limeButtonText}>{signingUp ? 'Create my Holdr' : 'Sign in'}</Text><Text style={styles.buttonArrow}>{'>'}</Text></Pressable>
          {Platform.OS !== 'web' && <>
            <View style={styles.authOr}><View style={styles.authOrLine} /><Text style={styles.authOrText}>OR</Text><View style={styles.authOrLine} /></View>
            <Pressable style={styles.googleButton} onPress={handleGoogleSignIn}><View style={styles.googleMark}><Text style={styles.googleMarkText}>G</Text></View><Text style={styles.googleButtonText}>Continue with Google</Text></Pressable>
            <Pressable style={[styles.googleButton, { marginTop: 10, backgroundColor: '#f3f4ef' }]} onPress={handleBypass}><Text style={styles.googleButtonText}>Bypass Login (Test Mode)</Text></Pressable>
          </>}
        </View>
        <Pressable style={styles.authSwitch} onPress={() => setMode(signingUp ? 'signin' : 'signup')}><Text style={styles.authSwitchText}>{signingUp ? 'Already have an account? ' : 'New to Holdr? '}<Text style={styles.authSwitchLink}>{signingUp ? 'Sign in' : 'Create an account'}</Text></Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function QuickActionButton({ icon, label, onPress, animationType }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; animationType: AnimationType }) {
  const [trigger, setTrigger] = useState(0);
  return (
    <AnimatedPressable 
      style={styles.ppQuickBtn} 
      onPress={() => {
        setTrigger(prev => prev + 1);
        onPress();
      }}
    >
      <View style={styles.ppQuickCircle}>
        <AnimatedFeatherIcon name={icon} size={24} color="#0070BA" animationTrigger={trigger} animationType={animationType} />
      </View>
      <Text style={styles.ppQuickText}>{label}</Text>
    </AnimatedPressable>
  );
}

function HomeView({ name, items, risk, onItemPress, onAdd }: { name: string; items: Item[]; risk: number; onItemPress: (item: Item) => void; onAdd: (options?: { step?: 'choose' | 'paste' | 'processing' | 'edit'; type?: ItemType; autoLaunchPhoto?: boolean }) => void }) {
  const urgent = items.filter(item => daysUntil(item.deadline) <= 14);
  const totalValue = items.reduce((sum, item) => sum + (item.amount || 0), 0);
  const insets = useSafeAreaInsets();
  const [awardTrigger, setAwardTrigger] = useState(0);
  const [searchTrigger, setSearchTrigger] = useState(0);
  
  return (
    <View style={{ flex: 1, backgroundColor: '#F5F7F8' }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.pageScroll, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 118 }]}>
        <View style={styles.ppTopBar}>
          <View style={styles.ppAvatar}><Text style={styles.ppAvatarText}>{name.slice(0, 2).toUpperCase()}</Text></View>
          <View style={styles.ppTopIcons}>
            <AnimatedPressable style={styles.ppTopIconCircle} onPress={() => { setAwardTrigger(prev => prev + 1); Alert.alert('Achievements', `You have tracked ${items.length} items in your Holdr!`); }}>
              <AnimatedFeatherIcon name="award" size={18} color="#0070BA" animationTrigger={awardTrigger} animationType="pop" />
            </AnimatedPressable>
            <AnimatedPressable style={styles.ppTopIconCircle} onPress={() => { setSearchTrigger(prev => prev + 1); Alert.alert('Search', 'Use the Vault tab to search and filter your items.'); }}>
              <AnimatedFeatherIcon name="search" size={18} color="#0070BA" animationTrigger={searchTrigger} animationType="pop" />
            </AnimatedPressable>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ppCardsScroll} contentContainerStyle={styles.ppCardsContainer}>
          <AnimatedPressable style={styles.ppBalanceCard}>
            <View style={styles.ppCardIcon}><Text style={styles.ppCardIconText}>H</Text></View>
            <Text style={styles.ppCardTitle}>Tracked items</Text>
            <Text style={styles.ppCardAmount}>{items.length}</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.ppBalanceCard}>
            <View style={styles.ppCardIcon}><Text style={styles.ppCardIconText}>H</Text></View>
            <Text style={styles.ppCardTitle}>Value on hold</Text>
            <Text style={styles.ppCardAmount}>${totalValue.toFixed(2)}</Text>
            <Text style={styles.ppCardAction}>View all</Text>
          </AnimatedPressable>
        </ScrollView>

        <AnimatedPressable style={styles.ppSetupCard} onPress={() => onAdd()}>
          <View style={styles.ppSetupIcon}><Text style={styles.ppSetupIconText}>+</Text></View>
          <View style={styles.ppSetupBody}>
            <Text style={styles.ppSetupTitle}>Add your first receipt</Text>
            <Text style={styles.ppSetupSub}>Keep track of returns.</Text>
          </View>
          <Text style={styles.ppSetupArrow}>→</Text>
        </AnimatedPressable>

        <View style={styles.ppActionsRow}>
          <AnimatedPressable style={styles.ppPillButton} onPress={() => onAdd()}>
            <Text style={styles.ppPillText}>Add item</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.ppPillButtonSecondary}>
            <Text style={styles.ppPillSecondaryText}>Vault</Text>
          </AnimatedPressable>
        </View>

        <View style={styles.ppQuickActions}>
          <Text style={styles.ppQuickTitle}>Quick actions</Text>
          <View style={styles.ppQuickRow}>
            <QuickActionButton icon="camera" label="Scan" onPress={() => onAdd({ step: 'choose', autoLaunchPhoto: true })} animationType="pop" />
            <QuickActionButton icon="tag" label="Deal" onPress={() => onAdd({ step: 'choose', type: 'coupon' })} animationType="wobble" />
            <QuickActionButton icon="shield" label="Warranty" onPress={() => onAdd({ step: 'choose', type: 'warranty' })} animationType="bounce" />
          </View>
        </View>

      </ScrollView>
    </View>
  );
}


function VaultView({ items, onItemPress, onAdd }: { items: Item[]; onItemPress: (item: Item) => void; onAdd: (options?: { step?: 'choose' | 'paste' | 'processing' | 'edit'; type?: ItemType; autoLaunchPhoto?: boolean }) => void }) {
  const [query, setQuery] = useState('');
  const filtered = items.filter(item => item.entity.toLowerCase().includes(query.toLowerCase()) || typeName(item.type).toLowerCase().includes(query.toLowerCase()));
  return <View style={styles.vaultPage}><View style={styles.vaultTitleRow}><View><Text style={styles.eyebrow}>YOUR VAULT</Text><Text style={styles.vaultTitle}>Everything held.</Text></View><AnimatedPressable onPress={() => onAdd()} style={styles.circleAdd}><Text style={styles.circleAddText}>+</Text></AnimatedPressable></View><View style={styles.search}><Feather name="search" size={16} color="#64716e" style={{ marginRight: 4 }} /><TextInput value={query} onChangeText={setQuery} placeholder="Search your Holdr" placeholderTextColor="#82908d" style={styles.searchInput} /></View><View style={styles.filterRow}><AnimatedPressable style={styles.filterActive}><Text style={styles.filterActiveText}>All {items.length}</Text></AnimatedPressable><AnimatedPressable style={styles.filter}><Text style={styles.filterText}>Returns</Text></AnimatedPressable><AnimatedPressable style={styles.filter}><Text style={styles.filterText}>Deals</Text></AnimatedPressable></View><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.vaultFeed}>{filtered.length ? filtered.map((item, index) => <AnimatedListItem key={item.id} index={index}><ItemRow item={item} onPress={() => onItemPress(item)} /></AnimatedListItem>) : <View style={styles.emptyState}><Text style={styles.emptyTitle}>Nothing matching yet.</Text><Text style={styles.emptyBody}>Try another word, or add something new.</Text></View>}</ScrollView></View>;
}

function ProfileView({ name, itemCount, onLogOut }: { name: string; itemCount: number; onLogOut: () => void }) {
  return <ScrollView contentContainerStyle={styles.profilePage} showsVerticalScrollIndicator={false}><Text style={styles.eyebrow}>YOUR ACCOUNT</Text><View style={styles.profileHero}><View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{name.slice(0, 2).toUpperCase()}</Text></View><View><Text style={styles.profileName}>{name}</Text><Text style={styles.profileEmail}>alex@holdr.app</Text></View></View><View style={styles.profileStats}><View><Text style={styles.profileStatNumber}>{itemCount}</Text><Text style={styles.profileStatLabel}>ITEMS HELD</Text></View><View style={styles.profileStatLine} /><View><Text style={styles.profileStatNumber}>$182</Text><Text style={styles.profileStatLabel}>TRACKED</Text></View></View><Text style={styles.settingsTitle}>Settings</Text><View style={styles.settings}><Setting label="Notifications" detail="Return windows and deals" /><Setting label="Forwarding address" detail="alex@in.holdr.app" /><Setting label="Privacy" detail="Your items stay yours" /></View><Pressable style={styles.logOut} onPress={onLogOut}><Text style={styles.logOutText}>Log out</Text></Pressable><Text style={styles.version}>HOLD R 0.1.0</Text></ScrollView>;
}

function Setting({ label, detail }: { label: string; detail: string }) { return <Pressable style={styles.setting}><View><Text style={styles.settingLabel}>{label}</Text><Text style={styles.settingDetail}>{detail}</Text></View><Text style={styles.settingArrow}>{'>'}</Text></Pressable>; }

function BottomTabs({ active, onChange, onAdd }: { active: Tab; onChange: (tab: Tab) => void; onAdd: () => void }) {
  const insets = useSafeAreaInsets();
  const [trigger, setTrigger] = useState(0);
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.45],
  });
  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 0],
  });

  const handlePress = () => {
    setTrigger(prev => prev + 1);
    onAdd();
  };

  return (
    <View style={[styles.ppTabs, { height: 60 + insets.bottom, paddingBottom: insets.bottom }]}>
      <TabButton label="Home" icon="home" active={active === 'home'} onPress={() => onChange('home')} />
      <TabButton label="Vault" icon="bar-chart-2" active={active === 'vault'} onPress={() => onChange('vault')} />
      <AnimatedPressable style={styles.ppAddTabBtn} onPress={handlePress}>
        <View style={styles.ppAddCircleContainer}>
          <Animated.View style={[styles.ppAddPulseRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
          <View style={styles.ppAddCircle}>
            <AnimatedFeatherIcon name="plus" size={26} color="#fff" animationTrigger={trigger} animationType="spin" />
          </View>
        </View>
        <Text style={styles.ppAddLabel}>Add</Text>
      </AnimatedPressable>
      <TabButton label="Deals" icon="tag" active={false} onPress={() => {}} />
      <TabButton label="Profile" icon="user" active={active === 'profile'} onPress={() => onChange('profile')} />
    </View>
  );
}


function TabButton({ label, icon, active, onPress }: { label: string; icon: keyof typeof Feather.glyphMap; active: boolean; onPress: () => void }) { 
  const color = active ? '#0070BA' : '#5C677D';
  const [trigger, setTrigger] = useState(0);

  const handlePress = () => {
    setTrigger(prev => prev + 1);
    onPress();
  };

  let animationType: AnimationType = 'pop';
  if (icon === 'home') animationType = 'bounce';
  else if (icon === 'bar-chart-2') animationType = 'pop';
  else if (icon === 'plus') animationType = 'spin';
  else if (icon === 'tag') animationType = 'wobble';
  else if (icon === 'user') animationType = 'pop';

  return (
    <AnimatedPressable style={styles.ppTabBtn} onPress={handlePress}>
      <AnimatedFeatherIcon name={icon} size={22} color={color} style={{ opacity: active ? 1 : 0.6 }} animationTrigger={trigger} animationType={animationType} />
      <Text style={[styles.ppTabLabel, active && styles.ppTabLabelActive]}>{label}</Text>
    </AnimatedPressable>
  );
}


function ItemRow({ item, onPress }: { item: Item; onPress: () => void }) {
  const days = daysUntil(item.deadline);
  const tone = item.type === 'receipt' ? '#b6e7d6' : item.type === 'coupon' ? '#ffd7cf' : '#fce8ac';
  const borderTone = item.type === 'receipt' ? '#3bb273' : item.type === 'coupon' ? '#e15a45' : '#e0a910';
  
  return (
    <AnimatedPressable style={[styles.itemRowCard, { borderLeftColor: borderTone }]} onPress={onPress}>
      <View style={[styles.itemIconCircle, { backgroundColor: tone }]}>
        <Text style={styles.itemIconText}>{itemMark(item.type)}</Text>
      </View>
      <View style={styles.itemCopy}>
        <Text style={styles.itemName}>{item.entity}</Text>
        <View style={styles.itemMeta}>
          <Text style={styles.itemMetaText}>
            {item.offer || (item.type === 'receipt' && item.amount ? `$${item.amount.toFixed(2)} return` : typeName(item.type))}
          </Text>
          {item.estimated ? <Text style={styles.estimatedPill}>ESTIMATE</Text> : null}
        </View>
      </View>
      <View style={styles.itemTime}>
        <Text style={[styles.itemTimeMain, days <= 3 && styles.itemTimeUrgent]}>
          {timeLabel(days)}
        </Text>
        <Text style={styles.itemTimeDate}>{dateLabel(item.deadline)}</Text>
      </View>
    </AnimatedPressable>
  );
}

function Composer({
  open,
  onClose,
  entity,
  setEntity,
  amount,
  setAmount,
  type,
  setType,
  deadline,
  setDeadline,
  estimated,
  setEstimated,
  onAdd,
  initialStep = 'choose',
  autoLaunchPhoto = false,
  googleToken,
}: {
  open: boolean;
  onClose: () => void;
  entity: string;
  setEntity: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  type: ItemType;
  setType: (value: ItemType) => void;
  deadline: string;
  setDeadline: (value: string) => void;
  estimated: boolean;
  setEstimated: (value: boolean) => void;
  onAdd: () => void;
  initialStep?: 'choose' | 'paste' | 'processing' | 'edit' | 'gmail';
  autoLaunchPhoto?: boolean;
  googleToken?: string | null;
}) {
  const [step, setStep] = useState<'choose' | 'paste' | 'processing' | 'edit' | 'gmail'>('choose');
  const [pasteText, setPasteText] = useState('');
  const [emails, setEmails] = useState<GmailEmail[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const spinValue = useRef(new Animated.Value(0)).current;

  const loadGmail = async () => {
    if (!googleToken) {
      Alert.alert(
        'Google Connection Required',
        'To scan your Gmail inbox, you must first connect your Google Account by signing in with Google on the Profile tab. If you already connected, please log out and log in again to approve Gmail access permissions.'
      );
      return;
    }
    setStep('gmail');
    setLoadingEmails(true);
    try {
      const res = await fetchRecentReceiptEmails(googleToken);
      setEmails(res);
    } catch (err) {
      console.error(err);
      Alert.alert('Gmail Sync Failed', 'Could not read emails from your Google Account. Please make sure the Gmail API is enabled and scopes are approved.');
      setStep('choose');
    } finally {
      setLoadingEmails(false);
    }
  };

  const processInput = async (source: 'photo' | 'text', payload: string, mimeType?: string) => {
    setStep('processing');
    const result = await simulateIngestion({ source, payload, mimeType });
    setEntity(result.entity);
    setType(result.type);
    setAmount(result.amount);
    setDeadline(result.deadline);
    setEstimated(result.estimated);
    setStep('edit');
  };

  const handlePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Holdr needs camera access to scan receipts.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets && result.assets[0].base64) {
      processInput('photo', result.assets[0].base64, result.assets[0].mimeType || 'image/jpeg');
    }
  };

  useEffect(() => {
    if (open) {
      setStep(initialStep || 'choose');
      setPasteText('');
      if (autoLaunchPhoto && (initialStep === 'choose' || !initialStep)) {
        const timer = setTimeout(() => {
          handlePhoto();
        }, 400);
        return () => clearTimeout(timer);
      }
    }
  }, [open, initialStep, autoLaunchPhoto]);

  useEffect(() => {
    if (step === 'processing') {
      spinValue.setValue(0);
      const anim = Animated.loop(Animated.timing(spinValue, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }));
      anim.start();
      return () => anim.stop();
    }
  }, [step, spinValue]);

  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.composerSafe}>
        <View style={styles.composerHeader}>
          <View>
            <Text style={styles.eyebrow}>NEW ITEM</Text>
            <Text style={styles.composerTitle}>Add it to Holdr</Text>
          </View>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>x</Text>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.composerScroll, { flexGrow: 1 }]}>
          {step === 'choose' && (
            <View style={styles.composerChooseContainer}>
              <View style={styles.composerChooseHeader}>
                <Text style={styles.composerChooseTitle}>Choose how to add</Text>
          <Text style={styles.composerChooseSubtitle}>
            Select the fastest method to automatically scan and extract details from your document.
          </Text>
        </View>

        <Pressable style={styles.composerLargeCard} onPress={handlePhoto}>
          <LinearGradient
            colors={['#E4F0FB', '#F5F7F8']}
            style={styles.composerCardGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.composerCardHeader}>
              <View style={[styles.composerCardIconCircle, { backgroundColor: '#0070BA' }]}>
                <Feather name="camera" size={24} color="#fff" />
              </View>
              <Text style={styles.composerCardTag}>RECOMMENDED</Text>
            </View>
            <Text style={styles.composerCardTitle}>Scan Paper Receipt</Text>
            <Text style={styles.composerCardDesc}>
              Snap a photo of your printed receipt, return slip, or warranty paper. Holdr will automatically extract the store name, prices, and expiration dates.
            </Text>
          </LinearGradient>
        </Pressable>

        <Pressable style={styles.composerLargeCard} onPress={() => setStep('paste')}>
          <LinearGradient
            colors={['#FFF5F3', '#F5F7F8']}
            style={styles.composerCardGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.composerCardHeader}>
              <View style={[styles.composerCardIconCircle, { backgroundColor: '#fb6e59' }]}>
                <Feather name="file-text" size={24} color="#fff" />
              </View>
            </View>
            <Text style={styles.composerCardTitle}>Paste Digital Text</Text>
            <Text style={styles.composerCardDesc}>
              Copy text from your email confirmation, digital receipt, or website. Holdr will parse the text to instantly find relevant details.
            </Text>
          </LinearGradient>
        </Pressable>

        <Pressable style={styles.composerLargeCard} onPress={loadGmail}>
          <LinearGradient
            colors={['#E8F5E9', '#F5F7F8']}
            style={styles.composerCardGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.composerCardHeader}>
              <View style={[styles.composerCardIconCircle, { backgroundColor: '#4CAF50' }]}>
                <Feather name="mail" size={24} color="#fff" />
              </View>
            </View>
            <Text style={styles.composerCardTitle}>Sync from Gmail</Text>
            <Text style={styles.composerCardDesc}>
              Connect directly to your Gmail inbox to scan recent orders, confirmations, and subscription receipt emails.
            </Text>
          </LinearGradient>
        </Pressable>

        <View style={styles.composerManualSection}>
          <View style={styles.composerManualDivider}>
            <View style={styles.composerManualLine} />
            <Text style={styles.composerManualDividerText}>OR</Text>
            <View style={styles.composerManualLine} />
          </View>
          <Pressable style={styles.composerManualBtn} onPress={() => setStep('edit')}>
            <Feather name="edit-2" size={16} color="#64716e" style={{ marginRight: 8 }} />
            <Text style={styles.composerManualBtnText}>Enter details manually</Text>
          </Pressable>
          <Text style={styles.composerManualSubtext}>Use only as a last resort if you have no receipt or text to scan.</Text>
        </View>
      </View>
    )}

    {step === 'paste' && <>
      <Text style={styles.pasteHint}>Paste text from an email, website, or screenshot. Holdr will extract the store, amount, and deadline.</Text>
      <TextInput style={styles.pasteInput} multiline placeholder="e.g. Order from Amazon for $45.00. Return within 30 days." value={pasteText} onChangeText={setPasteText} placeholderTextColor="#82908d" autoFocus />
      <Pressable style={[styles.limeButton, !pasteText.trim() && styles.buttonDisabled]} onPress={() => pasteText.trim() && processInput('text', pasteText)}><Text style={styles.limeButtonText}>Extract details</Text><Text style={styles.buttonArrow}>{'>'}</Text></Pressable>
    </>}

    {step === 'gmail' && (
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <Text style={styles.pasteHint}>Select a recent order, receipt, or subscription email from your inbox to extract details.</Text>
        {loadingEmails ? (
          <View style={styles.processingState}>
            <Animated.View style={[styles.spinner, { transform: [{ rotate: spin }] }]}><Text style={styles.spinnerText}>O</Text></Animated.View>
            <Text style={styles.processingTitle}>Searching your inbox...</Text>
            <Text style={styles.processingBody}>Looking for receipts, orders, and confirmation emails.</Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 400, marginTop: 10 }}>
            {emails.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No receipt emails found.</Text>
                <Text style={styles.emptyBody}>We couldn't find any recent purchase or order confirmation emails in your inbox.</Text>
              </View>
            ) : (
              emails.map((email) => {
                return (
                  <Pressable
                    key={email.id}
                    style={{
                      backgroundColor: '#fff',
                      padding: 14,
                      borderRadius: 12,
                      marginBottom: 10,
                      borderWidth: 1,
                      borderColor: '#e2e8f0',
                    }}
                    onPress={() => processInput('text', `Subject: ${email.subject}\nFrom: ${email.from}\nBody:\n${email.fullBody}`)}
                  >
                    <Text style={{ fontWeight: '600', fontSize: 14, color: '#1e293b', marginBottom: 2 }}>{email.subject}</Text>
                    <Text style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>From: {email.from}</Text>
                    <Text style={{ fontSize: 12, color: '#94a3b8' }} numberOfLines={2}>{email.snippet}</Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        )}
        <Pressable style={[styles.limeButton, { marginTop: 12, backgroundColor: '#f1f5f9' }]} onPress={() => setStep('choose')}>
          <Text style={[styles.limeButtonText, { color: '#475569' }]}>Back</Text>
        </Pressable>
      </View>
    )}

    {step === 'processing' && <View style={styles.processingState}>
      <Animated.View style={[styles.spinner, { transform: [{ rotate: spin }] }]}><Text style={styles.spinnerText}>O</Text></Animated.View>
      <Text style={styles.processingTitle}>Looking for clues...</Text>
      <Text style={styles.processingBody}>Extracting store, deadline, and type from your input.</Text>
    </View>}

    {step === 'edit' && <>
      <Text style={styles.composerHint}>Please review the details. You can change anything Holdr missed or got wrong.</Text>
      <Input label="Store or brand" value={entity} onChangeText={setEntity} placeholder="e.g. Target" />
      <Text style={styles.fieldLabel}>What is it?</Text>
      <View style={styles.typeRow}>{(['receipt', 'coupon', 'warranty'] as ItemType[]).map(value => <Pressable key={value} style={[styles.typeChip, type === value && styles.typeChipActive]} onPress={() => setType(value)}><Text style={[styles.typeChipText, type === value && styles.typeChipTextActive]}>{typeName(value)}</Text></Pressable>)}</View>
      <Input label="Amount (optional)" value={amount} onChangeText={setAmount} placeholder="$0.00" keyboardType="decimal-pad" />
      <Input label="Deadline (YYYY-MM-DD)" value={deadline} onChangeText={setDeadline} placeholder="2026-08-12" />
      <Pressable style={styles.estimateRow} onPress={() => setEstimated(!estimated)}>
        <View style={[styles.checkbox, estimated && styles.checkboxActive]}><Text style={styles.checkboxText}>{estimated ? 'OK' : ''}</Text></View>
        <View><Text style={styles.estimateTitle}>Estimated deadline</Text><Text style={styles.estimateCopy}>Use this when the receipt does not say.</Text></View>
      </Pressable>
      <Pressable style={styles.limeButton} onPress={onAdd}><Text style={styles.limeButtonText}>Save to Holdr</Text><Text style={styles.buttonArrow}>{'>'}</Text></Pressable>
    </>}
  </ScrollView></SafeAreaView></Modal>);
}

function DetailSheet({ item, onClose, onAdjust, onMarkUsed }: { item: Item | null; onClose: () => void; onAdjust: (days: number) => void; onMarkUsed: () => void }) {
  if (!item) return null;
  const days = daysUntil(item.deadline);
  const percent = Math.max(0, Math.min(100, (days / 30) * 100)); // Assume 30-day window
  const barColor = days <= 3 ? '#fb6e59' : '#3bb273';

  return (
    <Modal visible={!!item} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <View style={styles.detailSheetCard}>
          {/* Ticket Header */}
          <View style={styles.detailTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>
                {typeName(item.type).toUpperCase()} {item.estimated ? '• ESTIMATED' : '• VERIFIED'}
              </Text>
              <Text style={styles.detailTitle}>{item.entity}</Text>
            </View>
            <Pressable style={styles.closeButtonCircle} onPress={onClose}>
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>

          {/* Ticket Divider */}
          <View style={styles.dashDivider} />

          {/* Ticket Body / Deadline */}
          <View style={styles.detailDeadlineCard}>
            <Text style={styles.detailDeadlineLabel}>SECURE DEADLINE</Text>
            <Text style={styles.detailDeadlineValue}>{dateLong(item.deadline)}</Text>
            <Text style={[styles.detailDeadlineHintText, days <= 3 && { color: '#bd3221' }]}>
              {timeLabel(days)} ({dateLabel(item.deadline)})
            </Text>

            {/* Progress Bar */}
            <View style={styles.deadlineProgressTrack}>
              <View style={[styles.deadlineProgressBar, { width: `${percent}%`, backgroundColor: barColor }]} />
            </View>
          </View>

          {item.estimated ? (
            <Text style={styles.detailExplanation}>
              This return window is estimated. If you have the receipt, adjust the date below to match.
            </Text>
          ) : (
            <Text style={styles.detailExplanation}>
              Holdr is actively keeping watch over this item. You will be nudged before it expires.
            </Text>
          )}

          {/* Quick Adjust */}
          <Text style={styles.adjustLabel}>QUICK ADJUST WINDOW</Text>
          <View style={styles.adjustRow}>
            {[14, 30, 60, 90].map(daysOption => (
              <AnimatedPressable key={daysOption} style={styles.adjustButtonCard} onPress={() => onAdjust(daysOption)}>
                <Text style={styles.adjustText}>+{daysOption}d</Text>
              </AnimatedPressable>
            ))}
          </View>

          {/* Mock Barcode for Aesthetic Detail */}
          <View style={styles.barcodeContainer}>
            <View style={styles.barcodeLines}>
              {[2, 4, 1, 3, 2, 5, 1, 4, 2, 3, 1, 2, 4, 2, 1, 3, 2].map((w, i) => (
                <View key={i} style={{ width: w, backgroundColor: '#172122', height: 28, marginRight: i % 2 === 0 ? 2 : 1 }} />
              ))}
            </View>
            <Text style={styles.barcodeText}>HOLDR-{item.id}-{item.entity.slice(0, 3).toUpperCase()}</Text>
          </View>

          {/* Actions */}
          <AnimatedPressable style={styles.markUsedButtonCard} onPress={onMarkUsed}>
            <Text style={styles.markUsedText}>Mark Completed & Clear</Text>
          </AnimatedPressable>
        </View>
      </View>
    </Modal>
  );
}

function Input({ label, ...props }: { label: string; value: string; onChangeText: (text: string) => void; placeholder: string; keyboardType?: 'default' | 'decimal-pad' | 'email-address'; secureTextEntry?: boolean }) { return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} style={styles.input} autoCapitalize="none" placeholderTextColor="#82908d" /></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f6f2' }, app: { flex: 1, backgroundColor: '#f7f6f2' }, page: { flex: 1 }, pageScroll: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 118 }, wordmark: { color: '#172122', fontSize: 28, fontWeight: '800' }, coral: { color: '#fb6e59' }, eyebrow: { color: '#64716e', fontSize: 10, fontWeight: '700' },
  itemRowCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 5,
    shadowColor: '#172122',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  itemIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  detailSheetCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    width: '100%',
    shadowColor: '#172122',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 10,
  },
  closeButtonCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4ef',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashDivider: {
    borderTopWidth: 1,
    borderTopColor: '#dedfd9',
    borderStyle: 'dashed',
    marginVertical: 18,
  },
  detailDeadlineCard: {
    backgroundColor: '#f7f6f2',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e8ebd9',
  },
  detailDeadlineHintText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3bb273',
    marginTop: 4,
  },
  deadlineProgressTrack: {
    height: 6,
    backgroundColor: '#e1e4dd',
    borderRadius: 3,
    marginTop: 12,
    overflow: 'hidden',
  },
  deadlineProgressBar: {
    height: '100%',
    borderRadius: 3,
  },
  adjustButtonCard: {
    borderWidth: 1,
    borderColor: '#172122',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    minWidth: 65,
    alignItems: 'center',
  },
  barcodeContainer: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
  },
  barcodeLines: {
    flexDirection: 'row',
    height: 28,
    alignItems: 'center',
  },
  barcodeText: {
    fontSize: 9,
    color: '#64716e',
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 4,
  },
  markUsedButtonCard: {
    backgroundColor: '#172122',
    borderRadius: 16,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  onboardingSafe: { flex: 1, backgroundColor: '#f7f6f2' }, onboarding: { flex: 1, paddingHorizontal: 22 }, onboardingTop: { paddingTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, skip: { color: '#55625f', fontSize: 14, textDecorationLine: 'underline' }, onboardingMiddle: { height: '46%', minHeight: 310, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }, blobOne: { position: 'absolute', width: 245, height: 245, borderRadius: 123, backgroundColor: '#d9fb5a', top: 65, right: -65 }, blobTwo: { position: 'absolute', width: 110, height: 110, borderRadius: 55, backgroundColor: '#ffd7cf', bottom: 17, left: -25 }, storyCard: { width: 280, minHeight: 267, borderRadius: 16, borderWidth: 1, borderColor: '#172122', backgroundColor: '#fff', justifyContent: 'center', shadowColor: '#172122', shadowOffset: { width: 7, height: 8 }, shadowOpacity: 1, shadowRadius: 0, elevation: 8 }, onboardingBottom: { paddingBottom: 29 }, slideCount: { color: '#64716e', fontSize: 11, fontWeight: '700', marginBottom: 12 }, onboardingTitle: { color: '#172122', fontSize: 38, lineHeight: 40, fontWeight: '700', maxWidth: 355 }, onboardingBody: { color: '#64716e', fontSize: 16, lineHeight: 23, marginTop: 13, maxWidth: 350 }, progress: { flexDirection: 'row', gap: 6, marginTop: 25, marginBottom: 20 }, progressLine: { height: 4, flex: 1, borderRadius: 2, backgroundColor: '#d8d9d3' }, progressLineActive: { backgroundColor: '#172122' }, darkButton: { height: 54, borderRadius: 12, backgroundColor: '#172122', paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, darkButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' }, buttonArrow: { fontSize: 20, fontWeight: '400', color: 'inherit' },
  receiptStory: { padding: 23 }, storyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, storyBrand: { fontSize: 11, fontWeight: '800' }, storyDate: { color: '#64716e', fontSize: 9, fontWeight: '700' }, dash: { borderTopWidth: 1, borderTopColor: '#cdd1cc', borderStyle: 'dashed', marginVertical: 17 }, storyItem: { color: '#4c5755', fontSize: 13 }, storyAmount: { color: '#172122', fontSize: 31, fontWeight: '700', marginTop: 3 }, storyDeadline: { marginTop: 22, backgroundColor: '#d9fb5a', padding: 10, borderRadius: 8 }, storyDeadlineLabel: { color: '#42612d', fontWeight: '700', fontSize: 9 }, storyDeadlineDate: { color: '#172122', fontWeight: '800', fontSize: 18, marginTop: 2 }, storyFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 17 }, storyFooterText: { color: '#64716e', fontSize: 11 }, storyFooterMark: { color: '#172122', fontSize: 19 },
  deadlineStory: { padding: 23 }, deadlineKicker: { color: '#64716e', fontSize: 10, fontWeight: '700' }, deadlineBig: { fontSize: 61, fontWeight: '700', color: '#172122', marginTop: 3 }, deadlineUnit: { fontSize: 21, fontWeight: '400' }, deadlineBar: { height: 7, backgroundColor: '#e1e4dd', borderRadius: 6, overflow: 'hidden', marginTop: 8 }, deadlineBarFill: { width: '25%', height: '100%', backgroundColor: '#fb6e59' }, deadlineItem: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 23 }, deadlineIcon: { width: 42, height: 42, backgroundColor: '#b6e7d6', alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, deadlineIconText: { fontWeight: '800' }, deadlineItemName: { fontSize: 14, fontWeight: '700' }, deadlineItemMeta: { fontSize: 12, color: '#64716e', marginTop: 3 }, deadlinePrompt: { color: '#64716e', fontSize: 11, marginTop: 19 },
  doneStory: { alignItems: 'center', padding: 25 }, doneCheck: { width: 70, height: 70, backgroundColor: '#d9fb5a', borderRadius: 35, borderWidth: 1, borderColor: '#172122', alignItems: 'center', justifyContent: 'center' }, doneCheckText: { fontWeight: '800' }, doneTitle: { fontSize: 25, fontWeight: '700', marginTop: 16 }, doneBody: { color: '#64716e', textAlign: 'center', fontSize: 13, lineHeight: 18, marginTop: 5 }, doneRow: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#e1e4dd', paddingTop: 17, marginTop: 21 }, doneBrand: { fontWeight: '700', fontSize: 12 }, donePill: { backgroundColor: '#ffd7cf', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 3, fontSize: 10, fontWeight: '700' },
  authSafe: { flex: 1, backgroundColor: '#fff' }, authKeyboard: { flex: 1 }, authScroll: { paddingHorizontal: 22, paddingBottom: 30 }, authTop: { paddingTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, backButton: { paddingVertical: 8 }, backText: { fontSize: 14, color: '#172122' }, authVisual: { height: 160, marginTop: 23, backgroundColor: '#b6e7d6', borderRadius: 16, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }, authVisualSquare: { width: 116, height: 116, borderWidth: 1, borderColor: '#172122', borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-7deg' }] }, authVisualSmall: { color: '#64716e', fontSize: 9, fontWeight: '700' }, authVisualBig: { color: '#172122', fontSize: 47, fontWeight: '700', lineHeight: 50 }, authVisualTag: { position: 'absolute', right: 22, bottom: 20, backgroundColor: '#fb6e59', paddingHorizontal: 9, paddingVertical: 6, transform: [{ rotate: '6deg' }] }, authVisualTagText: { color: '#fff', fontSize: 9, fontWeight: '800' }, authTitle: { fontSize: 33, lineHeight: 36, fontWeight: '700', marginTop: 28 }, authBody: { color: '#64716e', fontSize: 15, lineHeight: 21, marginTop: 8 }, authForm: { marginTop: 15 }, fieldLabel: { color: '#172122', fontWeight: '700', fontSize: 13, marginTop: 15, marginBottom: 7 }, input: { height: 48, borderWidth: 1, borderColor: '#bfc6c0', borderRadius: 12, paddingHorizontal: 12, color: '#172122', fontSize: 15 }, limeButton: { minHeight: 53, marginTop: 23, paddingHorizontal: 17, borderWidth: 1, borderColor: '#172122', backgroundColor: '#d9fb5a', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, limeButtonText: { color: '#172122', fontSize: 16, fontWeight: '800' }, authOr: { flexDirection: 'row', alignItems: 'center', gap: 11, marginVertical: 18 }, authOrLine: { flex: 1, height: 1, backgroundColor: '#e1e4dd' }, authOrText: { color: '#82908d', fontSize: 10, fontWeight: '700' }, googleButton: { height: 51, borderRadius: 12, borderWidth: 1, borderColor: '#bfc6c0', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, googleMark: { width: 21, height: 21, borderRadius: 11, backgroundColor: '#f4be49', alignItems: 'center', justifyContent: 'center' }, googleMarkText: { color: '#172122', fontWeight: '800', fontSize: 12 }, googleButtonText: { fontWeight: '700' }, authSwitch: { alignSelf: 'center', marginTop: 24, padding: 6 }, authSwitchText: { color: '#64716e', fontSize: 14 }, authSwitchLink: { color: '#172122', fontWeight: '800', textDecorationLine: 'underline' },
  // PayPal Style UI classes
  ppTopBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  ppAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#0E3178', alignItems: 'center', justifyContent: 'center' },
  ppAvatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ppTopIcons: { flexDirection: 'row', gap: 10 },
  ppTopIconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E4F0FB', alignItems: 'center', justifyContent: 'center' },
  ppTopIconText: { fontSize: 16 },
  ppCardsScroll: { marginHorizontal: -22 },
  ppCardsContainer: { paddingHorizontal: 22, gap: 16 },
  ppBalanceCard: { width: 220, backgroundColor: '#fff', borderRadius: 20, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  ppCardIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  ppCardIconText: { color: '#0E3178', fontSize: 16, fontWeight: '900' },
  ppCardTitle: { color: '#5C677D', fontSize: 15, fontWeight: '600' },
  ppCardAmount: { color: '#001435', fontSize: 32, fontWeight: '800', marginTop: 4 },
  ppCardAction: { color: '#0070BA', fontSize: 15, fontWeight: '700', marginTop: 16 },
  ppSetupCard: { backgroundColor: '#fff', borderRadius: 16, padding: 18, marginTop: 24, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  ppSetupIcon: { width: 48, height: 48, borderRadius: 24, borderWidth: 3, borderColor: '#0070BA', alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  ppSetupIconText: { color: '#0070BA', fontSize: 24, fontWeight: '300' },
  ppSetupBody: { flex: 1 },
  ppSetupTitle: { color: '#001435', fontSize: 17, fontWeight: '700' },
  ppSetupSub: { color: '#5C677D', fontSize: 14, marginTop: 4 },
  ppSetupArrow: { color: '#001435', fontSize: 20 },
  ppActionsRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  ppPillButton: { flex: 1, backgroundColor: '#fb6e59', borderRadius: 28, height: 56, alignItems: 'center', justifyContent: 'center' },
  ppPillText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ppPillButtonSecondary: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#0E3178', borderRadius: 28, height: 56, alignItems: 'center', justifyContent: 'center' },
  ppPillSecondaryText: { color: '#0E3178', fontSize: 16, fontWeight: '700' },
  ppQuickActions: { marginTop: 32 },
  ppQuickTitle: { color: '#5C677D', fontSize: 18, fontWeight: '600', marginBottom: 16 },
  ppQuickRow: { flexDirection: 'row', gap: 24 },
  ppQuickBtn: { alignItems: 'center', width: 64 },
  ppQuickCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#E4F0FB', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  ppQuickCircleText: { fontSize: 24 },
  ppQuickText: { color: '#001435', fontSize: 14, fontWeight: '600' },
  ppTabs: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#EBEBEB' },
  ppTabBtn: { alignItems: 'center', justifyContent: 'center', minWidth: 60, height: '100%' },
  ppTabMark: { fontSize: 20, opacity: 0.5 },
  ppTabMarkActive: { opacity: 1 },
  ppTabLabel: { fontSize: 11, color: '#5C677D', marginTop: 4, fontWeight: '600' },
  ppTabLabelActive: { color: '#0070BA', fontWeight: '800' },

  ppAddTabBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 68,
    height: '100%',
    position: 'relative',
    top: -10,
  },
  ppAddCircleContainer: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ppAddPulseRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fb6e59',
  },
  ppAddCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fb6e59',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#fb6e59',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 2,
  },
  ppAddLabel: {
    fontSize: 10,
    color: '#fb6e59',
    marginTop: 4,
    fontWeight: '800',
  },

  composerChooseContainer: {
    paddingVertical: 10,
    flex: 1,
    justifyContent: 'space-between',
  },
  composerChooseHeader: {
    marginBottom: 20,
  },
  composerChooseTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#172122',
  },
  composerChooseSubtitle: {
    fontSize: 14,
    color: '#64716e',
    marginTop: 6,
    lineHeight: 20,
  },
  composerLargeCard: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#EBEBEB',
    marginBottom: 18,
    overflow: 'hidden',
    shadowColor: '#172122',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  composerCardGradient: {
    padding: 24,
    flex: 1,
    justifyContent: 'center',
  },
  composerCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  composerCardIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerCardTag: {
    backgroundColor: '#0E3178',
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    overflow: 'hidden',
    letterSpacing: 0.5,
  },
  composerCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#172122',
    marginBottom: 6,
  },
  composerCardDesc: {
    fontSize: 13,
    color: '#5C677D',
    lineHeight: 19,
  },
  composerManualSection: {
    marginTop: 15,
    alignItems: 'center',
  },
  composerManualDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  composerManualLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#EBEBEB',
  },
  composerManualDividerText: {
    color: '#82908d',
    fontSize: 11,
    fontWeight: '800',
    marginHorizontal: 12,
  },
  composerManualBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#bfc6c0',
    borderRadius: 14,
    height: 48,
    width: '100%',
    backgroundColor: '#fff',
  },
  composerManualBtnText: {
    color: '#64716e',
    fontSize: 14,
    fontWeight: '700',
  },
  composerManualSubtext: {
    fontSize: 11,
    color: '#97a09d',
    marginTop: 8,
    textAlign: 'center',
  },

  vaultPage: { flex: 1, paddingHorizontal: 22, paddingTop: 18, backgroundColor: '#F5F7F8' }, vaultTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, vaultTitle: { fontSize: 30, fontWeight: '700', marginTop: 2 }, circleAdd: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#fb6e59', alignItems: 'center', justifyContent: 'center' }, circleAddText: { color: '#fff', fontSize: 25, fontWeight: '300' }, search: { height: 49, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: '#bfc6c0', borderRadius: 12, backgroundColor: '#fff', marginTop: 22, gap: 9 }, searchMark: { fontSize: 13, color: '#64716e', fontWeight: '700' }, searchInput: { flex: 1, fontSize: 15, color: '#172122' }, filterRow: { flexDirection: 'row', gap: 7, marginTop: 15 }, filter: { borderWidth: 1, borderColor: '#cdd1cc', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }, filterActive: { borderWidth: 1, borderColor: '#172122', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#0E3178' }, filterText: { fontSize: 12, color: '#4c5755' }, filterActiveText: { fontSize: 12, color: '#fff', fontWeight: '700' }, vaultFeed: { paddingBottom: 105, marginTop: 16, borderTopWidth: 1, borderTopColor: '#dedfd9' }, emptyState: { alignItems: 'center', paddingTop: 75 }, emptyTitle: { fontSize: 20, fontWeight: '700' }, emptyBody: { color: '#64716e', marginTop: 7, fontSize: 14 },

  profilePage: { padding: 25, paddingBottom: 112 }, profileHero: { flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: 22 }, profileAvatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#ffd7cf', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#172122' }, profileAvatarText: { fontSize: 19, fontWeight: '800' }, profileName: { fontSize: 25, fontWeight: '700' }, profileEmail: { color: '#64716e', fontSize: 13, marginTop: 4 }, profileStats: { marginTop: 30, backgroundColor: '#b6e7d6', borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#172122' }, profileStatNumber: { fontSize: 26, fontWeight: '800' }, profileStatLabel: { color: '#42615c', fontSize: 9, fontWeight: '800', marginTop: 3 }, profileStatLine: { width: 1, height: 40, backgroundColor: '#6caaa0' }, settingsTitle: { fontSize: 20, fontWeight: '700', marginTop: 37, marginBottom: 12 }, settings: { borderTopWidth: 1, borderTopColor: '#dedfd9' }, setting: { minHeight: 69, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#dedfd9' }, settingLabel: { fontSize: 15, fontWeight: '700' }, settingDetail: { color: '#64716e', marginTop: 4, fontSize: 12 }, settingArrow: { fontSize: 16, color: '#64716e' }, logOut: { marginTop: 26, alignSelf: 'flex-start', paddingVertical: 9 }, logOutText: { color: '#bd3221', fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' }, version: { color: '#97a09d', fontSize: 9, fontWeight: '800', marginTop: 18 },
  toast: { position: 'absolute', left: 21, right: 21, bottom: 85, backgroundColor: '#172122', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 13, alignItems: 'center', shadowColor: '#172122', shadowOffset: { width: 0, height: 4 }, shadowOpacity: .18, shadowRadius: 12, elevation: 5 }, toastText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  composerSafe: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 22 }, composerHeader: { paddingTop: 9, paddingBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, composerTitle: { fontSize: 28, fontWeight: '700', marginTop: 4 }, closeButton: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#172122', alignItems: 'center', justifyContent: 'center' }, closeButtonText: { fontSize: 16, fontWeight: '700' }, composerScroll: { flexGrow: 1, paddingBottom: 27 }, captureRow: { flexDirection: 'row', gap: 10 }, captureCard: { flex: 1, minHeight: 105, borderWidth: 1, borderColor: '#cdd1cc', borderRadius: 12, padding: 13, justifyContent: 'space-between' }, captureNumber: { color: '#64716e', fontSize: 10, fontWeight: '800' }, captureTitle: { fontSize: 15, fontWeight: '700' }, captureCopy: { color: '#64716e', fontSize: 11, lineHeight: 15 }, composerHint: { color: '#64716e', fontSize: 12, lineHeight: 17, marginTop: 12 }, typeRow: { flexDirection: 'row', gap: 8 }, typeChip: { borderWidth: 1, borderColor: '#bfc6c0', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9 }, typeChipActive: { backgroundColor: '#172122', borderColor: '#172122' }, typeChipText: { color: '#4c5755', fontSize: 12 }, typeChipTextActive: { color: '#fff', fontWeight: '700' }, estimateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 }, checkbox: { width: 20, height: 20, borderWidth: 1, borderColor: '#172122', borderRadius: 3, alignItems: 'center', justifyContent: 'center' }, checkboxActive: { backgroundColor: '#d9fb5a' }, checkboxText: { fontSize: 8, fontWeight: '800' }, estimateTitle: { fontSize: 13, fontWeight: '700' }, estimateCopy: { color: '#64716e', fontSize: 12, marginTop: 3 },
  manualDivider: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 24, marginBottom: 15 }, manualLine: { flex: 1, height: 1, backgroundColor: '#e1e4dd' }, manualOr: { color: '#82908d', fontSize: 10, fontWeight: '700' }, manualButton: { height: 50, borderWidth: 1, borderColor: '#bfc6c0', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, manualButtonText: { color: '#172122', fontSize: 14, fontWeight: '700' },
  pasteHint: { color: '#64716e', fontSize: 14, lineHeight: 20, marginBottom: 15 }, pasteInput: { height: 140, borderWidth: 1, borderColor: '#bfc6c0', borderRadius: 12, padding: 14, paddingTop: 14, fontSize: 15, color: '#172122', textAlignVertical: 'top' }, buttonDisabled: { opacity: 0.5 },
  processingState: { alignItems: 'center', paddingTop: 60, paddingBottom: 80 }, spinner: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#d9fb5a', borderTopColor: '#172122', alignItems: 'center', justifyContent: 'center', marginBottom: 25 }, spinnerText: { fontSize: 10, fontWeight: '800', opacity: 0 }, processingTitle: { fontSize: 20, fontWeight: '700' }, processingBody: { color: '#64716e', marginTop: 8, fontSize: 14, textAlign: 'center' },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', padding: 15, backgroundColor: 'rgba(23,33,34,.48)' }, detailSheet: { backgroundColor: '#fff', borderRadius: 20, padding: 22 }, detailTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, detailTitle: { fontSize: 31, fontWeight: '700', marginTop: 4 }, detailDeadline: { marginTop: 23, backgroundColor: '#f3f4ef', borderRadius: 12, padding: 14 }, detailDeadlineLabel: { fontSize: 9, color: '#64716e', fontWeight: '800' }, detailDeadlineValue: { fontSize: 18, fontWeight: '700', marginTop: 4 }, detailDeadlineHint: { color: '#bd3221', fontSize: 12, fontWeight: '700', marginTop: 5 }, detailExplanation: { color: '#64716e', fontSize: 13, lineHeight: 19, marginTop: 16 }, adjustLabel: { color: '#64716e', fontSize: 10, fontWeight: '800', marginTop: 20, marginBottom: 8 }, adjustRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, adjustButton: { borderWidth: 1, borderColor: '#172122', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }, adjustText: { fontSize: 12, fontWeight: '700' }, markUsedButton: { backgroundColor: '#172122', borderRadius: 12, alignItems: 'center', minHeight: 50, justifyContent: 'center', marginTop: 23 }, markUsedText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
