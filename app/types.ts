export type Category = 'express' | 'meal';
export type Status = 'confirmed' | 'preparing' | 'ready' | 'collected' | 'cancelled' | 'refunded';
export interface MenuItem {
  id: string;
  name: string;
  description: string;
  category: Category;
  vegetarian: boolean;
  price: number;
  stock: number;
  available: boolean;
  image: string;
  foodGroup?: 'meals'|'biryani'|'snacks'|'desserts'|'drinks';
  mealEligible?: boolean;
}
export interface Slot {
  id: string;
  date: string;
  time: string;
  label: string;
  category: Category;
  capacity: number;
  reserved: number;
}
export interface Order {
  id: string;
  token: string;
  name: string;
  customerType: 'student' | 'faculty' | 'staff';
  status: Status;
  category: Category;
  slotId: string;
  pickupDate: string;
  pickupTime: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  total: number;
  paid: number;
  balance: number;
  paymentChoice: 'full' | 'deposit';
  createdAt: string;
  subtotal?:number;
  discount?:number;
  discountKind?:string;
  deliveryFee?:number;
  walletUsed?:number;
  fulfillment?:'pickup'|'delivery';
  destination?:string|null;
  recipientCode?:string;
  deliveryStatus?:string;
}
export interface CatalogResponse {
  user: { name: string; email: string; isVendor: boolean };
  today: string;
  tomorrow: string;
  menu: MenuItem[];
  slots: Slot[];
  paymentMode: 'test';
}
