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
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { DataStore, User } from './data';

GoogleSignin.configure({
  webClientId: '636307355753-f1lhbffqfeho7ongjfrefn8atkp2fo7p.apps.googleusercontent.com',
});

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

interface IngestionInput { source: 'photo' | 'text'; payload: string; }
interface IngestionResult { entity: string; type: ItemType; amount: string; deadline: string; estimated: boolean; offer?: string; }

const simulateIngestion = async (input: IngestionInput): Promise<IngestionResult> => {
  return new Promise(resolve => {
    setTimeout(() => {
      const result: IngestionResult = { entity: 'Unknown Store', type: 'receipt', amount: '', deadline: plusDays(30), estimated: true };
      if (input.source === 'photo') {
        result.entity = 'North Market'; result.type = 'receipt'; result.amount = '84.00'; result.deadline = plusDays(30); result.estimated = true;
      } else {
        const text = input.payload.toLowerCase();
        if (text.includes('amazon')) result.entity = 'Amazon';
        else if (text.includes('best buy')) result.entity = 'Best Buy';
        else if (text.includes('nike')) result.entity = 'Nike';
        else if (text.includes('target')) result.entity = 'Target';
        else if (text.trim()) result.entity = text.trim().split(' ')[0].replace(/^./, c => c.toUpperCase());

        if (text.includes('coupon') || text.includes('deal') || text.includes('off') || text.includes('promo')) result.type = 'coupon';
        else if (text.includes('warranty') || text.includes('guarantee')) result.type = 'warranty';

        const amt = text.match(/\$([0-9]+\.[0-9]{2})/);
        if (amt) result.amount = amt[1];

        const dt = text.match(/\d{4}-\d{2}-\d{2}/);
        if (dt) { result.deadline = dt[0]; result.estimated = false; }
        else {
          const days = text.match(/([0-9]+)\s+days/);
          if (days) { result.deadline = plusDays(parseInt(days[1], 10)); result.estimated = false; }
        }
      }
      resolve(result);
    }, 1800);
  });
};

const slides = [
  { count: '01', title: 'A better place for the things you might lose.', body: 'Receipts, returns, deals, and warranties. Finally all in one spot.', card: 'receipt' },
  { count: '02', title: 'Your money has a memory now.', body: 'Holdr spots the important date, then gives it a nudge before it is too late.', card: 'deadline' },
  { count: '03', title: 'Save it once. Stop thinking about it.', body: 'Snap a photo, forward an email, and get back to your day.', card: 'done' },
];

export default function App() {
  const [flow, setFlow] = useState<Flow>('onboarding');
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [authMode, setAuthMode] = useState<'signup' | 'signin'>('signup');
  const [tab, setTab] = useState<Tab>('home');
  const [userName, setUserName] = useState('Alex');
  const [items, setItems] = useState<Item[]>(initialItems);
  const [composerOpen, setComposerOpen] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [notice, setNotice] = useState('');
  const [entity, setEntity] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<ItemType>('receipt');
  const [deadline, setDeadline] = useState(plusDays(30));
  const [estimated, setEstimated] = useState(true);

  const heroFloat = useRef(new Animated.Value(0)).current;
  const screenEntrance = useRef(new Animated.Value(0)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (flow !== 'onboarding') return;
    heroFloat.setValue(0);
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(heroFloat, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(heroFloat, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [flow, heroFloat]);

  useEffect(() => {
    screenEntrance.setValue(0);
    Animated.timing(screenEntrance, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
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
  const authenticate = async (user?: import('./data').User) => {
    if (user) {
      await DataStore.saveUser(user);
      setUserName(user.name);
    }
    setFlow('home');
    setTab('home');
    showNotice('You are all set. Welcome to Holdr.');
  };
  const openComposer = () => {
    setEntity('');
    setAmount('');
    setType('receipt');
    setDeadline(plusDays(30));
    setEstimated(true);
    setComposerOpen(true);
  };
  const addItem = () => {
    if (!entity.trim()) return Alert.alert('Add a store or brand', 'For example: Amazon, Target, or Nike.');
    setItems(current => [...current, { id: Date.now(), entity: entity.trim(), amount: Number(amount.replace(/[^0-9.]/g, '')) || 0, type, deadline, estimated }]);
    setComposerOpen(false);
    showNotice(`${entity.trim()} is safe in your Holdr.`);
  };
  const adjustDeadline = (days: number) => {
    if (!selected) return;
    setItems(current => current.map(item => item.id === selected.id ? { ...item, deadline: plusDays(days), estimated: false } : item));
    setSelected(null);
    showNotice('Deadline updated. We will keep watch.');
  };
  const markUsed = () => {
    if (!selected) return;
    setItems(current => current.filter(item => item.id !== selected.id));
    setSelected(null);
    showNotice('Done. One less thing to hold onto.');
  };

  if (flow === 'onboarding') return <Onboarding step={onboardingStep} floatValue={heroFloat} onNext={nextOnboardingStep} onSkip={finishOnboarding} />;
  if (flow === 'auth') return <AuthScreen mode={authMode} setMode={setAuthMode} onBack={() => setFlow('onboarding')} onSuccess={authenticate} />;

  const enterStyle = { opacity: screenEntrance, transform: [{ translateY: screenEntrance.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] };
  return <SafeAreaView style={styles.safe}>
    <StatusBar style="dark" />
    <View style={styles.app}>
      <Animated.View style={[styles.page, enterStyle]}>
        {tab === 'home' && <HomeView name={userName} items={sortedItems} risk={risk} onItemPress={setSelected} onAdd={openComposer} />}
        {tab === 'vault' && <VaultView items={sortedItems} onItemPress={setSelected} onAdd={openComposer} />}
        {tab === 'profile' && <ProfileView name={userName} itemCount={items.length} onLogOut={() => setFlow('auth')} />}
      </Animated.View>
      <BottomTabs active={tab} onChange={setTab} onAdd={openComposer} />
    </View>
    {notice ? <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toastOpacity }]}><Text style={styles.toastText}>{notice}</Text></Animated.View> : null}
    <Composer open={composerOpen} onClose={() => setComposerOpen(false)} entity={entity} setEntity={setEntity} amount={amount} setAmount={setAmount} type={type} setType={setType} deadline={deadline} setDeadline={setDeadline} estimated={estimated} setEstimated={setEstimated} onAdd={addItem} />
    <DetailSheet item={selected} onClose={() => setSelected(null)} onAdjust={adjustDeadline} onMarkUsed={markUsed} />
  </SafeAreaView>;
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

function AnimatedListItem({ children, index, delay = 60 }: { children: React.ReactNode; index: number; delay?: number }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 400, delay: index * delay, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [enter, index, delay]);
  return <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>{children}</Animated.View>;
}

function Onboarding({ step, floatValue, onNext, onSkip }: { step: number; floatValue: Animated.Value; onNext: () => void; onSkip: () => void }) {
  const slide = slides[step];
  const translateY = floatValue.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

  const fade = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(15)).current;

  useEffect(() => {
    fade.setValue(0);
    slideY.setValue(15);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideY, { toValue: 0, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true })
    ]).start();
  }, [step, fade, slideY]);

  const handleNext = () => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }),
      Animated.timing(slideY, { toValue: -10, duration: 250, easing: Easing.in(Easing.quad), useNativeDriver: true })
    ]).start(() => onNext());
  };

  const handleSkip = () => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }),
      Animated.timing(slideY, { toValue: -10, duration: 250, easing: Easing.in(Easing.quad), useNativeDriver: true })
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

function AuthScreen({ mode, setMode, onBack, onSuccess }: { mode: 'signup' | 'signin'; setMode: (mode: 'signup' | 'signin') => void; onBack: () => void; onSuccess: (user: import('./data').User) => void }) {
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
            'Authorization': \`Bearer \${process.env.EXPO_PUBLIC_TURSO_AUTH_TOKEN}\`,
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
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      if (userInfo.data?.user) {
        onSuccess(userInfo.data.user.givenName || userInfo.data.user.name || 'Google User');
      } else if (userInfo.user) {
        // Fallback for older versions of the library
        onSuccess(userInfo.user.givenName || userInfo.user.name || 'Google User');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Google Sign-In Failed', 'Something went wrong while signing in with Google.');
    }
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
          <View style={styles.authOr}><View style={styles.authOrLine} /><Text style={styles.authOrText}>OR</Text><View style={styles.authOrLine} /></View>
          <Pressable style={styles.googleButton} onPress={handleGoogleSignIn}><View style={styles.googleMark}><Text style={styles.googleMarkText}>G</Text></View><Text style={styles.googleButtonText}>Continue with Google</Text></Pressable>
        </View>
        <Pressable style={styles.authSwitch} onPress={() => setMode(signingUp ? 'signin' : 'signup')}><Text style={styles.authSwitchText}>{signingUp ? 'Already have an account? ' : 'New to Holdr? '}<Text style={styles.authSwitchLink}>{signingUp ? 'Sign in' : 'Create an account'}</Text></Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function HomeView({ name, items, risk, onItemPress, onAdd }: { name: string; items: Item[]; risk: number; onItemPress: (item: Item) => void; onAdd: () => void }) {
  const urgent = items.filter(item => daysUntil(item.deadline) <= 14);
  return <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pageScroll}>
    <View style={styles.homeTop}><View><Text style={styles.eyebrow}>{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</Text><Text style={styles.homeHello}>Hey, {name}.</Text></View><View style={styles.avatar}><Text style={styles.avatarText}>{name.slice(0, 2).toUpperCase()}</Text></View></View>
    <Text style={styles.homeSubtitle}>Here is what needs a little attention.</Text>
    <View style={styles.riskCard}><View><Text style={styles.riskLabel}>AT RISK THIS WEEK</Text><Text style={styles.riskValue}>${risk.toFixed(2)}</Text><Text style={styles.riskHelper}>across {urgent.length} upcoming items</Text></View><AnimatedPressable onPress={onAdd} style={styles.riskAdd}><Text style={styles.riskAddText}>+</Text></AnimatedPressable></View>
    <View style={styles.sectionHead}><Text style={styles.sectionTitle}>Coming up</Text><Text style={styles.sectionHint}>NEXT 14 DAYS</Text></View>
    <View style={styles.feed}>{urgent.map((item, index) => <AnimatedListItem key={item.id} index={index + 1}><ItemRow item={item} onPress={() => onItemPress(item)} /></AnimatedListItem>)}</View>
    <AnimatedListItem index={urgent.length + 1}><AnimatedPressable style={styles.addInline} onPress={onAdd}><Text style={styles.addInlinePlus}>+</Text><Text style={styles.addInlineText}>Add something to Holdr</Text></AnimatedPressable></AnimatedListItem>
  </ScrollView>;
}

function VaultView({ items, onItemPress, onAdd }: { items: Item[]; onItemPress: (item: Item) => void; onAdd: () => void }) {
  const [query, setQuery] = useState('');
  const filtered = items.filter(item => item.entity.toLowerCase().includes(query.toLowerCase()) || typeName(item.type).toLowerCase().includes(query.toLowerCase()));
  return <View style={styles.vaultPage}><View style={styles.vaultTitleRow}><View><Text style={styles.eyebrow}>YOUR VAULT</Text><Text style={styles.vaultTitle}>Everything held.</Text></View><AnimatedPressable onPress={onAdd} style={styles.circleAdd}><Text style={styles.circleAddText}>+</Text></AnimatedPressable></View><View style={styles.search}><Text style={styles.searchMark}>O</Text><TextInput value={query} onChangeText={setQuery} placeholder="Search your Holdr" placeholderTextColor="#82908d" style={styles.searchInput} /></View><View style={styles.filterRow}><AnimatedPressable style={styles.filterActive}><Text style={styles.filterActiveText}>All {items.length}</Text></AnimatedPressable><AnimatedPressable style={styles.filter}><Text style={styles.filterText}>Returns</Text></AnimatedPressable><AnimatedPressable style={styles.filter}><Text style={styles.filterText}>Deals</Text></AnimatedPressable></View><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.vaultFeed}>{filtered.length ? filtered.map((item, index) => <AnimatedListItem key={item.id} index={index}><ItemRow item={item} onPress={() => onItemPress(item)} /></AnimatedListItem>) : <View style={styles.emptyState}><Text style={styles.emptyTitle}>Nothing matching yet.</Text><Text style={styles.emptyBody}>Try another word, or add something new.</Text></View>}</ScrollView></View>;
}

function ProfileView({ name, itemCount, onLogOut }: { name: string; itemCount: number; onLogOut: () => void }) {
  return <ScrollView contentContainerStyle={styles.profilePage} showsVerticalScrollIndicator={false}><Text style={styles.eyebrow}>YOUR ACCOUNT</Text><View style={styles.profileHero}><View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{name.slice(0, 2).toUpperCase()}</Text></View><View><Text style={styles.profileName}>{name}</Text><Text style={styles.profileEmail}>alex@holdr.app</Text></View></View><View style={styles.profileStats}><View><Text style={styles.profileStatNumber}>{itemCount}</Text><Text style={styles.profileStatLabel}>ITEMS HELD</Text></View><View style={styles.profileStatLine} /><View><Text style={styles.profileStatNumber}>$182</Text><Text style={styles.profileStatLabel}>TRACKED</Text></View></View><Text style={styles.settingsTitle}>Settings</Text><View style={styles.settings}><Setting label="Notifications" detail="Return windows and deals" /><Setting label="Forwarding address" detail="alex@in.holdr.app" /><Setting label="Privacy" detail="Your items stay yours" /></View><Pressable style={styles.logOut} onPress={onLogOut}><Text style={styles.logOutText}>Log out</Text></Pressable><Text style={styles.version}>HOLD R 0.1.0</Text></ScrollView>;
}

function Setting({ label, detail }: { label: string; detail: string }) { return <Pressable style={styles.setting}><View><Text style={styles.settingLabel}>{label}</Text><Text style={styles.settingDetail}>{detail}</Text></View><Text style={styles.settingArrow}>{'>'}</Text></Pressable>; }

function BottomTabs({ active, onChange, onAdd }: { active: Tab; onChange: (tab: Tab) => void; onAdd: () => void }) {
  return <View style={styles.tabs}><TabButton label="Home" mark="H" active={active === 'home'} onPress={() => onChange('home')} /><TabButton label="Vault" mark="V" active={active === 'vault'} onPress={() => onChange('vault')} /><AnimatedPressable accessibilityLabel="Add item" style={styles.tabAdd} onPress={onAdd}><Text style={styles.tabAddText}>+</Text></AnimatedPressable><TabButton label="Profile" mark="P" active={active === 'profile'} onPress={() => onChange('profile')} /></View>;
}

function TabButton({ label, mark, active, onPress }: { label: string; mark: string; active: boolean; onPress: () => void }) { return <AnimatedPressable style={styles.tabButton} onPress={onPress}><Text style={[styles.tabMark, active && styles.tabMarkActive]}>{mark}</Text><Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text></AnimatedPressable>; }

function ItemRow({ item, onPress }: { item: Item; onPress: () => void }) {
  const days = daysUntil(item.deadline);
  const tone = item.type === 'receipt' ? styles.receiptTone : item.type === 'coupon' ? styles.couponTone : styles.warrantyTone;
  return <AnimatedPressable style={styles.itemRow} onPress={onPress}><View style={[styles.itemIcon, tone]}><Text style={styles.itemIconText}>{itemMark(item.type)}</Text></View><View style={styles.itemCopy}><Text style={styles.itemName}>{item.entity}</Text><View style={styles.itemMeta}><Text style={styles.itemMetaText}>{item.offer || (item.type === 'receipt' && item.amount ? `$${item.amount.toFixed(2)} return` : typeName(item.type))}</Text>{item.estimated ? <Text style={styles.estimatedPill}>ESTIMATE</Text> : null}</View></View><View style={styles.itemTime}><Text style={[styles.itemTimeMain, days <= 2 && styles.itemTimeUrgent]}>{timeLabel(days)}</Text><Text style={styles.itemTimeDate}>{dateLabel(item.deadline)}</Text></View></AnimatedPressable>;
}

function Composer({ open, onClose, entity, setEntity, amount, setAmount, type, setType, deadline, setDeadline, estimated, setEstimated, onAdd }: { open: boolean; onClose: () => void; entity: string; setEntity: (value: string) => void; amount: string; setAmount: (value: string) => void; type: ItemType; setType: (value: ItemType) => void; deadline: string; setDeadline: (value: string) => void; estimated: boolean; setEstimated: (value: boolean) => void; onAdd: () => void }) {
  const [step, setStep] = useState<'choose' | 'paste' | 'processing' | 'edit'>('choose');
  const [pasteText, setPasteText] = useState('');
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) { setStep('choose'); setPasteText(''); }
  }, [open]);

  useEffect(() => {
    if (step === 'processing') {
      spinValue.setValue(0);
      const anim = Animated.loop(Animated.timing(spinValue, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }));
      anim.start();
      return () => anim.stop();
    }
  }, [step, spinValue]);

  const processInput = async (source: 'photo' | 'text', payload: string) => {
    setStep('processing');
    const result = await simulateIngestion({ source, payload });
    setEntity(result.entity);
    setType(result.type);
    setAmount(result.amount);
    setDeadline(result.deadline);
    setEstimated(result.estimated);
    setStep('edit');
  };

  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><SafeAreaView style={styles.composerSafe}><View style={styles.composerHeader}><View><Text style={styles.eyebrow}>NEW ITEM</Text><Text style={styles.composerTitle}>Add it to Holdr</Text></View><Pressable style={styles.closeButton} onPress={onClose}><Text style={styles.closeButtonText}>x</Text></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.composerScroll}>
    {step === 'choose' && <>
      <View style={styles.captureRow}><Pressable style={styles.captureCard} onPress={() => processInput('photo', 'mock-uri')}><Text style={styles.captureNumber}>01</Text><Text style={styles.captureTitle}>Snap a photo</Text><Text style={styles.captureCopy}>A receipt or a paper deal</Text></Pressable><Pressable style={styles.captureCard} onPress={() => setStep('paste')}><Text style={styles.captureNumber}>02</Text><Text style={styles.captureTitle}>Paste text</Text><Text style={styles.captureCopy}>A digital receipt or code</Text></Pressable></View>
      <View style={styles.manualDivider}><View style={styles.manualLine} /><Text style={styles.manualOr}>OR</Text><View style={styles.manualLine} /></View>
      <Pressable style={styles.manualButton} onPress={() => setStep('edit')}><Text style={styles.manualButtonText}>Enter details manually</Text></Pressable>
    </>}

    {step === 'paste' && <>
      <Text style={styles.pasteHint}>Paste text from an email, website, or screenshot. Holdr will extract the store, amount, and deadline.</Text>
      <TextInput style={styles.pasteInput} multiline placeholder="e.g. Order from Amazon for $45.00. Return within 30 days." value={pasteText} onChangeText={setPasteText} placeholderTextColor="#82908d" autoFocus />
      <Pressable style={[styles.limeButton, !pasteText.trim() && styles.buttonDisabled]} onPress={() => pasteText.trim() && processInput('text', pasteText)}><Text style={styles.limeButtonText}>Extract details</Text><Text style={styles.buttonArrow}>{'>'}</Text></Pressable>
    </>}

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
  </ScrollView></SafeAreaView></Modal>;
}

function DetailSheet({ item, onClose, onAdjust, onMarkUsed }: { item: Item | null; onClose: () => void; onAdjust: (days: number) => void; onMarkUsed: () => void }) {
  return <Modal visible={!!item} transparent animationType="fade" onRequestClose={onClose}><View style={styles.sheetOverlay}><View style={styles.detailSheet}>{item ? <><View style={styles.detailTop}><View><Text style={styles.eyebrow}>{typeName(item.type).toUpperCase()} {item.estimated ? '/ ESTIMATED' : ''}</Text><Text style={styles.detailTitle}>{item.entity}</Text></View><Pressable style={styles.closeButton} onPress={onClose}><Text style={styles.closeButtonText}>x</Text></Pressable></View><View style={styles.detailDeadline}><Text style={styles.detailDeadlineLabel}>DEADLINE</Text><Text style={styles.detailDeadlineValue}>{dateLong(item.deadline)}</Text><Text style={styles.detailDeadlineHint}>{timeLabel(daysUntil(item.deadline))}</Text></View>{item.estimated ? <Text style={styles.detailExplanation}>This is a 30-day estimate. If you know the real return window, change it in one tap.</Text> : <Text style={styles.detailExplanation}>Holdr will remind you before this deadline gets away from you.</Text>}<Text style={styles.adjustLabel}>QUICK ADJUST</Text><View style={styles.adjustRow}>{[14, 30, 60, 90].map(days => <Pressable key={days} style={styles.adjustButton} onPress={() => onAdjust(days)}><Text style={styles.adjustText}>{days} days</Text></Pressable>)}</View><Pressable style={styles.markUsedButton} onPress={onMarkUsed}><Text style={styles.markUsedText}>Mark {item.type === 'receipt' ? 'returned' : 'used'}</Text></Pressable></> : null}</View></View></Modal>;
}

function Input({ label, ...props }: { label: string; value: string; onChangeText: (text: string) => void; placeholder: string; keyboardType?: 'default' | 'decimal-pad' | 'email-address'; secureTextEntry?: boolean }) { return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} style={styles.input} autoCapitalize="none" placeholderTextColor="#82908d" /></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f6f2' }, app: { flex: 1, backgroundColor: '#f7f6f2' }, page: { flex: 1 }, pageScroll: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 118 }, wordmark: { color: '#172122', fontSize: 28, fontWeight: '800' }, coral: { color: '#fb6e59' }, eyebrow: { color: '#64716e', fontSize: 10, fontWeight: '700' },
  onboardingSafe: { flex: 1, backgroundColor: '#f7f6f2' }, onboarding: { flex: 1, paddingHorizontal: 22 }, onboardingTop: { paddingTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, skip: { color: '#55625f', fontSize: 14, textDecorationLine: 'underline' }, onboardingMiddle: { height: '46%', minHeight: 310, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }, blobOne: { position: 'absolute', width: 245, height: 245, borderRadius: 123, backgroundColor: '#d9fb5a', top: 65, right: -65 }, blobTwo: { position: 'absolute', width: 110, height: 110, borderRadius: 55, backgroundColor: '#ffd7cf', bottom: 17, left: -25 }, storyCard: { width: 280, minHeight: 267, borderRadius: 8, borderWidth: 1, borderColor: '#172122', backgroundColor: '#fff', justifyContent: 'center', shadowColor: '#172122', shadowOffset: { width: 7, height: 8 }, shadowOpacity: 1, shadowRadius: 0, elevation: 8 }, onboardingBottom: { paddingBottom: 29 }, slideCount: { color: '#64716e', fontSize: 11, fontWeight: '700', marginBottom: 12 }, onboardingTitle: { color: '#172122', fontSize: 38, lineHeight: 40, fontWeight: '700', maxWidth: 355 }, onboardingBody: { color: '#64716e', fontSize: 16, lineHeight: 23, marginTop: 13, maxWidth: 350 }, progress: { flexDirection: 'row', gap: 6, marginTop: 25, marginBottom: 20 }, progressLine: { height: 4, flex: 1, borderRadius: 2, backgroundColor: '#d8d9d3' }, progressLineActive: { backgroundColor: '#172122' }, darkButton: { height: 54, borderRadius: 4, backgroundColor: '#172122', paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, darkButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' }, buttonArrow: { fontSize: 20, fontWeight: '400', color: 'inherit' },
  receiptStory: { padding: 23 }, storyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, storyBrand: { fontSize: 11, fontWeight: '800' }, storyDate: { color: '#64716e', fontSize: 9, fontWeight: '700' }, dash: { borderTopWidth: 1, borderTopColor: '#cdd1cc', borderStyle: 'dashed', marginVertical: 17 }, storyItem: { color: '#4c5755', fontSize: 13 }, storyAmount: { color: '#172122', fontSize: 31, fontWeight: '700', marginTop: 3 }, storyDeadline: { marginTop: 22, backgroundColor: '#d9fb5a', padding: 10, borderRadius: 4 }, storyDeadlineLabel: { color: '#42612d', fontWeight: '700', fontSize: 9 }, storyDeadlineDate: { color: '#172122', fontWeight: '800', fontSize: 18, marginTop: 2 }, storyFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 17 }, storyFooterText: { color: '#64716e', fontSize: 11 }, storyFooterMark: { color: '#172122', fontSize: 19 },
  deadlineStory: { padding: 23 }, deadlineKicker: { color: '#64716e', fontSize: 10, fontWeight: '700' }, deadlineBig: { fontSize: 61, fontWeight: '700', color: '#172122', marginTop: 3 }, deadlineUnit: { fontSize: 21, fontWeight: '400' }, deadlineBar: { height: 7, backgroundColor: '#e1e4dd', borderRadius: 4, overflow: 'hidden', marginTop: 8 }, deadlineBarFill: { width: '25%', height: '100%', backgroundColor: '#fb6e59' }, deadlineItem: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 23 }, deadlineIcon: { width: 42, height: 42, backgroundColor: '#b6e7d6', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }, deadlineIconText: { fontWeight: '800' }, deadlineItemName: { fontSize: 14, fontWeight: '700' }, deadlineItemMeta: { fontSize: 12, color: '#64716e', marginTop: 3 }, deadlinePrompt: { color: '#64716e', fontSize: 11, marginTop: 19 },
  doneStory: { alignItems: 'center', padding: 25 }, doneCheck: { width: 70, height: 70, backgroundColor: '#d9fb5a', borderRadius: 35, borderWidth: 1, borderColor: '#172122', alignItems: 'center', justifyContent: 'center' }, doneCheckText: { fontWeight: '800' }, doneTitle: { fontSize: 25, fontWeight: '700', marginTop: 16 }, doneBody: { color: '#64716e', textAlign: 'center', fontSize: 13, lineHeight: 18, marginTop: 5 }, doneRow: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#e1e4dd', paddingTop: 17, marginTop: 21 }, doneBrand: { fontWeight: '700', fontSize: 12 }, donePill: { backgroundColor: '#ffd7cf', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 3, fontSize: 10, fontWeight: '700' },
  authSafe: { flex: 1, backgroundColor: '#fff' }, authKeyboard: { flex: 1 }, authScroll: { paddingHorizontal: 22, paddingBottom: 30 }, authTop: { paddingTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, backButton: { paddingVertical: 8 }, backText: { fontSize: 14, color: '#172122' }, authVisual: { height: 160, marginTop: 23, backgroundColor: '#b6e7d6', borderRadius: 7, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }, authVisualSquare: { width: 116, height: 116, borderWidth: 1, borderColor: '#172122', borderRadius: 5, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-7deg' }] }, authVisualSmall: { color: '#64716e', fontSize: 9, fontWeight: '700' }, authVisualBig: { color: '#172122', fontSize: 47, fontWeight: '700', lineHeight: 50 }, authVisualTag: { position: 'absolute', right: 22, bottom: 20, backgroundColor: '#fb6e59', paddingHorizontal: 9, paddingVertical: 6, transform: [{ rotate: '6deg' }] }, authVisualTagText: { color: '#fff', fontSize: 9, fontWeight: '800' }, authTitle: { fontSize: 33, lineHeight: 36, fontWeight: '700', marginTop: 28 }, authBody: { color: '#64716e', fontSize: 15, lineHeight: 21, marginTop: 8 }, authForm: { marginTop: 15 }, fieldLabel: { color: '#172122', fontWeight: '700', fontSize: 13, marginTop: 15, marginBottom: 7 }, input: { height: 48, borderWidth: 1, borderColor: '#bfc6c0', borderRadius: 4, paddingHorizontal: 12, color: '#172122', fontSize: 15 }, limeButton: { minHeight: 53, marginTop: 23, paddingHorizontal: 17, borderWidth: 1, borderColor: '#172122', backgroundColor: '#d9fb5a', borderRadius: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, limeButtonText: { color: '#172122', fontSize: 16, fontWeight: '800' }, authOr: { flexDirection: 'row', alignItems: 'center', gap: 11, marginVertical: 18 }, authOrLine: { flex: 1, height: 1, backgroundColor: '#e1e4dd' }, authOrText: { color: '#82908d', fontSize: 10, fontWeight: '700' }, googleButton: { height: 51, borderRadius: 4, borderWidth: 1, borderColor: '#bfc6c0', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, googleMark: { width: 21, height: 21, borderRadius: 11, backgroundColor: '#f4be49', alignItems: 'center', justifyContent: 'center' }, googleMarkText: { color: '#172122', fontWeight: '800', fontSize: 12 }, googleButtonText: { fontWeight: '700' }, authSwitch: { alignSelf: 'center', marginTop: 24, padding: 6 }, authSwitchText: { color: '#64716e', fontSize: 14 }, authSwitchLink: { color: '#172122', fontWeight: '800', textDecorationLine: 'underline' },
  homeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, homeHello: { fontSize: 31, fontWeight: '700', marginTop: 3 }, avatar: { width: 43, height: 43, borderRadius: 22, borderWidth: 1, borderColor: '#172122', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }, avatarText: { fontSize: 12, fontWeight: '800' }, homeSubtitle: { color: '#64716e', marginTop: 8, fontSize: 15 }, riskCard: { marginTop: 28, padding: 19, borderRadius: 6, borderWidth: 1, borderColor: '#172122', backgroundColor: '#d9fb5a', minHeight: 130, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, riskLabel: { color: '#38572e', fontSize: 10, fontWeight: '800' }, riskValue: { fontSize: 38, fontWeight: '800', marginTop: 2 }, riskHelper: { color: '#42612d', fontSize: 12, marginTop: 2 }, riskAdd: { width: 37, height: 37, borderRadius: 19, backgroundColor: '#172122', alignItems: 'center', justifyContent: 'center' }, riskAddText: { fontSize: 27, lineHeight: 27, color: '#fff', fontWeight: '300' }, sectionHead: { marginTop: 36, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }, sectionTitle: { fontSize: 22, fontWeight: '700' }, sectionHint: { color: '#64716e', fontSize: 9, fontWeight: '700', marginBottom: 3 }, feed: { borderTopWidth: 1, borderTopColor: '#dedfd9' }, itemRow: { minHeight: 85, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#dedfd9' }, itemIcon: { width: 48, height: 48, borderRadius: 5, alignItems: 'center', justifyContent: 'center', marginRight: 13 }, receiptTone: { backgroundColor: '#b6e7d6' }, couponTone: { backgroundColor: '#ffd7cf' }, warrantyTone: { backgroundColor: '#fce8ac' }, itemIconText: { fontSize: 14, fontWeight: '800' }, itemCopy: { flex: 1, minWidth: 0 }, itemName: { color: '#172122', fontSize: 17, fontWeight: '700' }, itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }, itemMetaText: { color: '#64716e', fontSize: 12 }, estimatedPill: { fontSize: 8, color: '#64716e', fontWeight: '700', borderWidth: 1, borderColor: '#bfc6c0', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 2 }, itemTime: { width: 80, alignItems: 'flex-end' }, itemTimeMain: { color: '#64716e', fontSize: 10, fontWeight: '800', textAlign: 'right' }, itemTimeUrgent: { color: '#bd3221' }, itemTimeDate: { color: '#64716e', fontSize: 11, marginTop: 3 }, addInline: { minHeight: 56, marginTop: 17, borderWidth: 1, borderStyle: 'dashed', borderColor: '#9ba5a1', borderRadius: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }, addInlinePlus: { fontSize: 22, fontWeight: '300' }, addInlineText: { fontSize: 14, fontWeight: '700' },
  tabs: { position: 'absolute', height: 72, bottom: 0, left: 0, right: 0, paddingHorizontal: 14, paddingBottom: 9, backgroundColor: 'rgba(255, 255, 255, 0.95)', borderTopWidth: 1, borderTopColor: 'rgba(225, 228, 221, 0.5)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }, tabButton: { alignItems: 'center', justifyContent: 'center', minWidth: 61, gap: 3 }, tabMark: { color: '#97a09d', fontWeight: '700', fontSize: 13 }, tabMarkActive: { color: '#172122' }, tabLabel: { color: '#97a09d', fontSize: 10 }, tabLabelActive: { color: '#172122', fontWeight: '800' }, tabAdd: { width: 48, height: 48, marginTop: -26, borderRadius: 24, backgroundColor: '#172122', borderWidth: 4, borderColor: '#f7f6f2', alignItems: 'center', justifyContent: 'center', shadowColor: '#172122', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 }, tabAddText: { color: '#fff', fontSize: 28, lineHeight: 28, fontWeight: '300' },
  vaultPage: { flex: 1, paddingHorizontal: 22, paddingTop: 18 }, vaultTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, vaultTitle: { fontSize: 30, fontWeight: '700', marginTop: 2 }, circleAdd: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#172122', alignItems: 'center', justifyContent: 'center' }, circleAddText: { color: '#fff', fontSize: 25, fontWeight: '300' }, search: { height: 49, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: '#bfc6c0', borderRadius: 4, backgroundColor: '#fff', marginTop: 22, gap: 9 }, searchMark: { fontSize: 13, color: '#64716e', fontWeight: '700' }, searchInput: { flex: 1, fontSize: 15, color: '#172122' }, filterRow: { flexDirection: 'row', gap: 7, marginTop: 15 }, filter: { borderWidth: 1, borderColor: '#cdd1cc', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8 }, filterActive: { borderWidth: 1, borderColor: '#172122', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#172122' }, filterText: { fontSize: 12, color: '#4c5755' }, filterActiveText: { fontSize: 12, color: '#fff', fontWeight: '700' }, vaultFeed: { paddingBottom: 105, marginTop: 16, borderTopWidth: 1, borderTopColor: '#dedfd9' }, emptyState: { alignItems: 'center', paddingTop: 75 }, emptyTitle: { fontSize: 20, fontWeight: '700' }, emptyBody: { color: '#64716e', marginTop: 7, fontSize: 14 },
  profilePage: { padding: 25, paddingBottom: 112 }, profileHero: { flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: 22 }, profileAvatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#ffd7cf', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#172122' }, profileAvatarText: { fontSize: 19, fontWeight: '800' }, profileName: { fontSize: 25, fontWeight: '700' }, profileEmail: { color: '#64716e', fontSize: 13, marginTop: 4 }, profileStats: { marginTop: 30, backgroundColor: '#b6e7d6', borderRadius: 6, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#172122' }, profileStatNumber: { fontSize: 26, fontWeight: '800' }, profileStatLabel: { color: '#42615c', fontSize: 9, fontWeight: '800', marginTop: 3 }, profileStatLine: { width: 1, height: 40, backgroundColor: '#6caaa0' }, settingsTitle: { fontSize: 20, fontWeight: '700', marginTop: 37, marginBottom: 12 }, settings: { borderTopWidth: 1, borderTopColor: '#dedfd9' }, setting: { minHeight: 69, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#dedfd9' }, settingLabel: { fontSize: 15, fontWeight: '700' }, settingDetail: { color: '#64716e', marginTop: 4, fontSize: 12 }, settingArrow: { fontSize: 16, color: '#64716e' }, logOut: { marginTop: 26, alignSelf: 'flex-start', paddingVertical: 9 }, logOutText: { color: '#bd3221', fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' }, version: { color: '#97a09d', fontSize: 9, fontWeight: '800', marginTop: 18 },
  toast: { position: 'absolute', left: 21, right: 21, bottom: 85, backgroundColor: '#172122', borderRadius: 4, paddingHorizontal: 15, paddingVertical: 13, alignItems: 'center', shadowColor: '#172122', shadowOffset: { width: 0, height: 4 }, shadowOpacity: .18, shadowRadius: 12, elevation: 5 }, toastText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  composerSafe: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 22 }, composerHeader: { paddingTop: 9, paddingBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, composerTitle: { fontSize: 28, fontWeight: '700', marginTop: 4 }, closeButton: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#172122', alignItems: 'center', justifyContent: 'center' }, closeButtonText: { fontSize: 16, fontWeight: '700' }, composerScroll: { paddingBottom: 27 }, captureRow: { flexDirection: 'row', gap: 10 }, captureCard: { flex: 1, minHeight: 105, borderWidth: 1, borderColor: '#cdd1cc', borderRadius: 5, padding: 13, justifyContent: 'space-between' }, captureNumber: { color: '#64716e', fontSize: 10, fontWeight: '800' }, captureTitle: { fontSize: 15, fontWeight: '700' }, captureCopy: { color: '#64716e', fontSize: 11, lineHeight: 15 }, composerHint: { color: '#64716e', fontSize: 12, lineHeight: 17, marginTop: 12 }, typeRow: { flexDirection: 'row', gap: 8 }, typeChip: { borderWidth: 1, borderColor: '#bfc6c0', borderRadius: 4, paddingHorizontal: 11, paddingVertical: 9 }, typeChipActive: { backgroundColor: '#172122', borderColor: '#172122' }, typeChipText: { color: '#4c5755', fontSize: 12 }, typeChipTextActive: { color: '#fff', fontWeight: '700' }, estimateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 }, checkbox: { width: 20, height: 20, borderWidth: 1, borderColor: '#172122', borderRadius: 3, alignItems: 'center', justifyContent: 'center' }, checkboxActive: { backgroundColor: '#d9fb5a' }, checkboxText: { fontSize: 8, fontWeight: '800' }, estimateTitle: { fontSize: 13, fontWeight: '700' }, estimateCopy: { color: '#64716e', fontSize: 12, marginTop: 3 },
  manualDivider: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 24, marginBottom: 15 }, manualLine: { flex: 1, height: 1, backgroundColor: '#e1e4dd' }, manualOr: { color: '#82908d', fontSize: 10, fontWeight: '700' }, manualButton: { height: 50, borderWidth: 1, borderColor: '#bfc6c0', borderRadius: 4, alignItems: 'center', justifyContent: 'center' }, manualButtonText: { color: '#172122', fontSize: 14, fontWeight: '700' },
  pasteHint: { color: '#64716e', fontSize: 14, lineHeight: 20, marginBottom: 15 }, pasteInput: { height: 140, borderWidth: 1, borderColor: '#bfc6c0', borderRadius: 4, padding: 14, paddingTop: 14, fontSize: 15, color: '#172122', textAlignVertical: 'top' }, buttonDisabled: { opacity: 0.5 },
  processingState: { alignItems: 'center', paddingTop: 60, paddingBottom: 80 }, spinner: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#d9fb5a', borderTopColor: '#172122', alignItems: 'center', justifyContent: 'center', marginBottom: 25 }, spinnerText: { fontSize: 10, fontWeight: '800', opacity: 0 }, processingTitle: { fontSize: 20, fontWeight: '700' }, processingBody: { color: '#64716e', marginTop: 8, fontSize: 14, textAlign: 'center' },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', padding: 15, backgroundColor: 'rgba(23,33,34,.48)' }, detailSheet: { backgroundColor: '#fff', borderRadius: 8, padding: 22 }, detailTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, detailTitle: { fontSize: 31, fontWeight: '700', marginTop: 4 }, detailDeadline: { marginTop: 23, backgroundColor: '#f3f4ef', borderRadius: 5, padding: 14 }, detailDeadlineLabel: { fontSize: 9, color: '#64716e', fontWeight: '800' }, detailDeadlineValue: { fontSize: 18, fontWeight: '700', marginTop: 4 }, detailDeadlineHint: { color: '#bd3221', fontSize: 12, fontWeight: '700', marginTop: 5 }, detailExplanation: { color: '#64716e', fontSize: 13, lineHeight: 19, marginTop: 16 }, adjustLabel: { color: '#64716e', fontSize: 10, fontWeight: '800', marginTop: 20, marginBottom: 8 }, adjustRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, adjustButton: { borderWidth: 1, borderColor: '#172122', borderRadius: 4, paddingHorizontal: 11, paddingVertical: 8 }, adjustText: { fontSize: 12, fontWeight: '700' }, markUsedButton: { backgroundColor: '#172122', borderRadius: 4, alignItems: 'center', minHeight: 50, justifyContent: 'center', marginTop: 23 }, markUsedText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
