import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { HomeDetails, AdditionalServices } from '@/types/homeowner';
import { DEFAULT_ADDITIONAL_SERVICES, FLATWORK_DEFAULT_SQFT } from '@/types/homeowner';

export interface PastBooking {
  id: string;
  referenceNumber: string;
  scheduledStart: string | null;
  status: string;
  total: number;
  homeDetails: HomeDetails;
  additionalServices: AdditionalServices;
  servicesJson: Array<{ name: string; price: number }>;
}

export interface CustomerRecord {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  address: string | null;
}

export interface CustomerLookupResult {
  customer: CustomerRecord;
  bookings: PastBooking[];
}

export function useCustomerLookup() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CustomerLookupResult | null>(null);

  const lookupByEmail = async (email: string): Promise<CustomerLookupResult | null> => {
    setIsLoading(true);
    setError(null);

    try {
      // Look up customer by email
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('id, email, first_name, last_name, phone, address')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle();

      if (customerError) {
        throw new Error('Failed to look up customer');
      }

      if (!customer) {
        setResult(null);
        return null;
      }

      // Fetch past bookings for this customer
      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('id, reference_number, scheduled_start, status, total, home_details_json, services_json')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (bookingsError) {
        throw new Error('Failed to fetch bookings');
      }

      const parsedBookings: PastBooking[] = (bookings || []).map(b => {
        const homeDetails = b.home_details_json as unknown as HomeDetails;
        const servicesArray = b.services_json as unknown as Array<{ name: string; price: number }>;
        // Extract additional services from services
        const additionalServices = extractAdditionalServices(servicesArray);
        
        return {
          id: b.id,
          referenceNumber: b.reference_number,
          scheduledStart: b.scheduled_start,
          status: b.status,
          total: Number(b.total),
          homeDetails,
          additionalServices,
          servicesJson: servicesArray,
        };
      });

      const lookupResult: CustomerLookupResult = {
        customer: {
          id: customer.id,
          email: customer.email,
          firstName: customer.first_name,
          lastName: customer.last_name,
          phone: customer.phone,
          address: customer.address,
        },
        bookings: parsedBookings,
      };

      setResult(lookupResult);
      return lookupResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lookup failed';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const clearResult = () => {
    setResult(null);
    setError(null);
  };

  return {
    lookupByEmail,
    clearResult,
    result,
    isLoading,
    error,
  };
}

// Helper to extract additional services from the services JSON
function extractAdditionalServices(services: Array<{ name: string; price: number }>): AdditionalServices {
  const serviceNames = services.map(s => s.name.toLowerCase());
  
  return {
    windowCleaning: serviceNames.some(n => n.includes('window')),
    drivewayCleaning: {
      enabled: serviceNames.some(n => n.includes('driveway')),
      sqft: FLATWORK_DEFAULT_SQFT.driveway,
      surfaceType: 'concrete',
    },
    pressureWashing: {
      enabled: serviceNames.some(n => n.includes('pressure') && !n.includes('driveway')),
      surfaceType: 'concrete',
      frontPorch: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.frontPorch, surfaceType: 'concrete' },
      backPatio: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.backPatio, surfaceType: 'concrete' },
      poolDeck: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.poolDeck, surfaceType: 'concrete' },
      walkways: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.walkways, surfaceType: 'concrete' },
    },
    gutterCleaning: serviceNames.some(n => n.includes('gutter')),
    gutterAddons: {
      undergroundDrains: { enabled: false, count: '1' },
      minorRepairs: false,
      gutterGuards: { enabled: false, linearFeet: 150 },
    },
    houseWash: serviceNames.some(n => n.includes('house wash')),
    houseWashDetails: {
      sidingMaterial: 'vinyl',
      stainType: 'organic',
    },
    roofCleaning: serviceNames.some(n => n.includes('roof')),
    roofType: 'asphalt',
    roofSeverity: 'light',
    roofPitch: 'walkable',
  };
}
