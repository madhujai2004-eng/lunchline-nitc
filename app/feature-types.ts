export interface RegistryEntry {
  email: string;
  studentId: string | null;
  role: 'student' | 'faculty' | 'staff';
  residence: 'hostel' | 'day_scholar' | 'none';
  needApproved: boolean;
  active: boolean;
  expiresOn: string;
}
export interface AccountResponse {
  google: { configured: boolean; clientId: string | null; linked: boolean; email: string | null };
  profile: RegistryEntry | null;
  discount: { kind: 'hostel' | 'day_scholar' | 'none'; description: string };
  wallet: { balance: number; entries: {id:string;kind:string;amount:number;createdAt:string;sourceId:string}[] };
  incidents: Incident[];
  canDeliver: boolean;
}
export interface QuoteRequest {
  items: {menuItemId:string;quantity:number}[];
  slotId:string;
  fulfillment?:'pickup'|'delivery';
  destination?:string;
  useWallet?:boolean;
}
export interface Quote {
  subtotal:number;
  discount:number;
  discountKind:'hostel'|'day_scholar'|'none';
  discountDescription:string;
  deliveryFee:number;
  total:number;
  walletUsed:number;
  payNow:number;
  depositNow:number;
}
export interface Delivery {
  orderId:string;
  token:string;
  status:'open'|'claimed'|'picked_up'|'delivered'|'review_hold'|'released'|'failed';
  destination:string;
  items:{name:string;quantity:number}[];
  fee:number;
  courierName?:string;
  isMine:boolean;
  claimedAt:number|null;
  claimExpiresAt:number|null;
  deadlineAt:number|null;
  pickupCode?:string;
  recipientCode?:string;
}
export interface Incident {
  id:string;
  orderId:string;
  courierUserId:string;
  status:'open'|'fined'|'cleared'|'paid';
  reason:string;
  fine:number;
  createdAt:string;
}
export interface DeliveryBoard {
  deliveries:Delivery[];
  presenceUntil:number|null;
  counterCode?:string;
  canDeliver:boolean;
  incidents:Incident[];
}
