// This service has been modified to mock authentication because the Firebase dependency
// is missing or incompatible in the current environment. 
// This ensures the application compiles and runs using the "Demo User" fallback in App.tsx.

export interface MockFirebaseUser {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  uid: string;
}

export const loginWithGoogle = async (): Promise<MockFirebaseUser> => {
    // Simulating a failed login or unconfigured state to trigger the catch block in App.tsx
    // which automatically logs the user in as a Demo User.
    console.warn("Firebase is not configured in this environment. Falling back to Demo Mode.");
    throw new Error("Firebase not configured");
};

export const logoutUser = async () => {
    console.log("Simulated logout complete.");
};