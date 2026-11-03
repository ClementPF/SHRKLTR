// tag::sample[]
package calc.entity;

import javax.persistence.*;
import java.util.ArrayList;
import java.util.List;

@Entity
@NamedQuery(name = "User.findByUserName", query = "SELECT p FROM User p WHERE p.userName = ?1")
public class User {

    @Id
    @GeneratedValue(strategy=GenerationType.AUTO)
    private Long userId;
    private String firstName;
    private String lastName;
    @Column(unique = true, nullable = false)
    private String userName;
    @Column(unique = true, nullable = false)
    private String externalId;
    private String externalIdProvider;
//    @Column(nullable = false)
    private String password;
    private String profilePictureUrl;
//    @Column(unique = true, nullable = false)
    private String email;
    private String pushId;
    private String locale;

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL)
    private List<Stats> stats;

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL)
    private List<RivalryStats> rivalry_stats;

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL)
    private List<Outcome> outcomes;

    public User() {}

    public User(String userName) {
        this.userName = userName;
        this.stats = new ArrayList<Stats>();
    }

    public User(String userName, String externalId) {
        this.userName = userName;
        this.externalId = externalId;
        this.stats = new ArrayList<Stats>();
    }

    /*public User(String userName, String email) {
        this.userName = userName;
        this.email = email;
        this.stats = new ArrayList<Stats>();
    }*/

    @Override
    public String toString() {
        return String.format(
                "User[id=%d, firstName='%s', lastName='%s']",
                userId, firstName, lastName);
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public String getUserName() {
        return userName;
    }

    public void setUserName(String userName) {
        this.userName = userName;
    }

    public String getExternalId() { return externalId; }

    public void setExternalId(String externalId) {  this.externalId = externalId; }

    public String getExternalIdProvider() { return externalIdProvider;}

    public void setExternalIdProvider(String externalIdProvider) { this.externalIdProvider = externalIdProvider; }

    public String getPassword() { return password; }

    public void setPassword(String password) { this.password = password; }

    public String getEmail() { return email; }

    public void setEmail(String email) { this.email = email;}

    public List<Stats> getStats() {
        return stats;
    }

    public Stats getStats(Tournament tournament) {
        for(Stats s : stats){
            if(s.getTournament().equals(tournament)) {
                return s;
            }
        }
        return null;
    }

    public List<RivalryStats> getRivalryStats() {
        return rivalry_stats;
    }

    public void setRivalryStats(List<RivalryStats> rivalryStats) {
        this.rivalry_stats = rivalryStats;
    }

    public void setStats(List<Stats> stats) {
        this.stats = stats;
    }

    public List<Outcome> getOutcomes() {
        return outcomes;
    }

    public void setOutcomes(List<Outcome> outcomes) {
        this.outcomes = outcomes;
    }
    public String getPushId() { return pushId; }

    public void setPushId(String pushId) { this.pushId = pushId; }

    public List<RivalryStats> getRivalry_stats() {
        return rivalry_stats;
    }

    public void setRivalry_stats(List<RivalryStats> rivalry_stats) {
        this.rivalry_stats = rivalry_stats;
    }

    public String getFirstName() {
        return firstName;
    }

    public void setFirstName(String firstName) {
        this.firstName = firstName;
    }

    public String getLastName() {
        return lastName;
    }

    public void setLastName(String lastName) {
        this.lastName = lastName;
    }

    public String getProfilePictureUrl() {
        return profilePictureUrl;
    }

    public void setProfilePictureUrl(String profilePictureUrl) {
        this.profilePictureUrl = profilePictureUrl;
    }

    public String getLocale() {
        return locale;
    }

    public void setLocale(String locale) {
        this.locale = locale;
    }
}

