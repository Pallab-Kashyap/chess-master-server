# Mongoose Model Improvements

## Updated Models

### 1. Game Model (`src/models/game.ts`)

**Changes:**

- ✅ Updated imports to use centralized types from `src/types/game.ts`
- ✅ Fixed `TimeControl` import issue
- ✅ Used proper `PlayerColor`, `GameStatus`, `GameResult`, `Winner` types
- ✅ Made `result` field optional (games in progress don't have results yet)
- ✅ Added proper validation with custom error messages
- ✅ Added `DEFAULT_FEN` import and usage
- ✅ Added `timestamps: true` for automatic `createdAt`/`updatedAt`
- ✅ Improved schema options with `toJSON` and `toObject` virtuals
- ✅ Added validation constraints (min/max for ratings, array length validation)

### 2. User Model (`src/models/user.ts`)

**Changes:**

- ✅ Added proper validation with custom error messages
- ✅ Added field constraints (minlength, maxlength, email regex)
- ✅ Added `unique: true` and proper indexing
- ✅ Added `timestamps: true`
- ✅ Added `trim: true` and `lowercase: true` for email
- ✅ Added compound indexes for better query performance
- ✅ Improved error messages and field validation

### 3. UserProfile Model (`src/models/userProfile.ts`)

**Changes:**

- ✅ Fixed `userId` type from `string` to `Types.ObjectId`
- ✅ Created proper `IRating` interface for rating structure
- ✅ Added game statistics fields (`totalGames`, `wins`, `losses`, `draws`)
- ✅ Added validation constraints (min/max for ratings and stats)
- ✅ Added virtual field for `winRate` calculation
- ✅ Added proper default values and schema structure
- ✅ Added `timestamps: true` and proper indexing
- ✅ Improved type safety with separate rating schema

### 4. AnalysedGame Model (`src/models/analysedGame.ts`)

**Changes:**

- ✅ **Complete rewrite** - was just a copy of User model
- ✅ Created proper game analysis model with:
  - Move-by-move analysis with engine evaluation
  - Accuracy tracking for both players
  - Opening identification and game phase analysis
  - Analysis status tracking (`pending`, `analyzing`, `completed`, `failed`)
  - Engine configuration (name, depth)
- ✅ Added comprehensive interfaces for analysis data
- ✅ Added proper relationships with `Game` and `User` models
- ✅ Added compound indexes for efficient querying
- ✅ Added virtual fields for calculated values

## Type Safety Improvements

### Before:

```typescript
// Scattered types, inconsistent naming
interface IPlayer extends Document {
  color: PLAYER_COLOR; // Enum mismatch
  postRating?: number; // Inconsistent nullability
}

// No validation
const schema = new Schema({
  color: { type: String, enum: ["white", "black"] },
});
```

### After:

```typescript
// Centralized types, consistent naming
interface IPlayer extends Document {
  color: PlayerColor; // From centralized types
  postRating?: number | null; // Explicit nullability
}

// Proper validation with custom messages
const schema = new Schema({
  color: {
    type: String,
    enum: ["white", "black"],
    required: true,
  },
  preRating: {
    type: Number,
    required: true,
    min: [0, "Rating cannot be negative"],
    max: [4000, "Rating cannot exceed 4000"],
  },
});
```

## Model Conversion Utilities

Added utility functions in `src/types/game.ts` for converting between Mongoose documents and DTOs:

- `playerDocumentToDTO()` - Convert IPlayer to PlayerDTO
- `moveDocumentToDTO()` - Convert IMove to MoveDTO
- `gameHashToGameDocument()` - Convert GameHashDTO to Game document format
- `isValidRatingKey()` - Validate rating keys

## Database Performance Improvements

### Indexes Added:

- **User**: `{ username: 1, email: 1 }`, individual unique indexes
- **UserProfile**: `{ userId: 1 }` unique index
- **Game**: `{ "players.userId": 1 }`, `{ endedAt: -1 }`
- **AnalysedGame**: `{ gameId: 1, userId: 1 }`, `{ userId: 1, analysisDate: -1 }`, `{ status: 1, createdAt: 1 }`

### Schema Options:

- `timestamps: true` - Automatic createdAt/updatedAt
- `toJSON: { virtuals: true }` - Include virtual fields in JSON output
- `toObject: { virtuals: true }` - Include virtual fields in object conversion

## Validation Improvements

### Field-Level Validation:

- Email regex validation
- Username length constraints (3-20 characters)
- Rating bounds (0-4000)
- Required field validation with custom messages
- Array length validation (games must have exactly 2 players)

### Business Logic Validation:

- Game statistics cannot be negative
- Engine depth constraints (1-50)
- Move accuracy percentages (0-100)
- Proper enum validation for all categorical fields

## Breaking Changes & Migration Notes

1. **UserProfile.userId**: Changed from `string` to `Types.ObjectId`

   - **Migration needed**: Update existing queries and data

2. **Game.result**: Now optional instead of required

   - **Migration needed**: Update game creation logic

3. **AnalysedGame**: Complete model rewrite
   - **Migration needed**: Existing analysis data will need to be migrated or recreated

## Benefits Achieved

- ✅ **Type Safety**: All models use centralized, consistent types
- ✅ **Performance**: Proper indexing for common query patterns
- ✅ **Validation**: Comprehensive input validation with helpful error messages
- ✅ **Maintainability**: Consistent patterns across all models
- ✅ **Developer Experience**: Better IntelliSense and compile-time checking
- ✅ **Data Integrity**: Constraints prevent invalid data at the database level
- ✅ **Scalability**: Optimized for chess application query patterns
