package calc.service;

import calc.DTO.*;
import calc.entity.Sport;
import calc.entity.Tournament;
import calc.entity.User;
import calc.exception.APIException;
import calc.repository.GameRepository;
import calc.repository.SportRepository;
import calc.repository.TournamentRepository;
import calc.repository.UserRepository;
import org.modelmapper.ModelMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.text.ParseException;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Created by clementperez on 9/25/16.
 */
@Service
public class TournamentService {

    @Autowired
    private TournamentRepository tournamentRepository;
    @Autowired
    private TournamentService tournamentService;
    @Autowired
    private GameRepository gameRepository;
    @Autowired
    private SportService sportService;
    @Autowired
    private SportRepository sportRepository;
    @Autowired
    private UserService userService;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private GameService gameService;
    @Autowired
    private ModelMapper modelMapper;

    public List<TournamentDTO> findBySport(SportDTO sport){
        return this.findBySportId(sport.getSportId());
    }

    public TournamentDTO findOne(Long id){
        Tournament t = tournamentRepository.findOne(id);
        return convertToDto(t);
    }

    public List<TournamentDTO> findAll(){

       List<Tournament> tournaments = tournamentRepository.findAll();

        Collections.sort(
                tournaments,
                (t1, t2) -> t2.getGames().size()
                        - t1.getGames().size());

       return tournaments.stream().map(t -> convertToDto(t)).collect(Collectors.toList());
    }

    public List<TournamentDTO> findBySportId(Long sportId){
        if(sportRepository.findBySportId(sportId) == null){
            throw new APIException(Sport.class, sportId + "", HttpStatus.NOT_FOUND);
        }
        return tournamentRepository.findBySportId(sportId).stream().map(t -> convertToDto(t)).collect(Collectors.toList());
    }

    public List<TournamentDTO> findByUserName(String username) {
        if(userRepository.findByUserName(username) == null){
            throw new APIException(User.class, username + "", HttpStatus.NOT_FOUND);
        }
        return tournamentRepository.findByUserName(username).stream().map(t -> convertToDto(t)).collect(Collectors.toList());
    }

    public TournamentDTO createTournament(TournamentDTO tournament) {

        if(tournamentService.findByName(tournament.getName()) != null){
            throw new APIException(Tournament.class, tournament.getName() + " Already exists", HttpStatus.BAD_REQUEST);
        }else if (tournament.getSport() == null){
            throw new APIException(Tournament.class, tournament.getName() + " sport is a required field", HttpStatus.BAD_REQUEST);
        }

        UserDTO owner = userService.whoIsLoggedIn();
        tournament.setOwner(owner);

        SportDTO s = tournament.getSport();
        String sportName = s.getName();
        Sport sport = sportRepository.findByName(s.getName());

        if(sport == null) {
            sport = new Sport(sportName);
            sportRepository.save(sport);
        }

        return save(tournament);
    }

    public TournamentDTO save(TournamentDTO tournament){

        if(tournamentService.findByName(tournament.getName()) != null){
            throw new APIException(Tournament.class, tournament.getName() + " is not a valid name", HttpStatus.BAD_REQUEST);
        }else if (tournament.getSport() == null){
            throw new APIException(Tournament.class, tournament.getName() + " sport is a required field", HttpStatus.BAD_REQUEST);
        }

        Sport sport = sportRepository.findByName(tournament.getSport().getName());
        User owner = userRepository.findByUserName(tournament.getOwner().getUsername());
        Tournament t = new Tournament(tournament.getDisplayName(),sport, owner);
        return convertToDto(tournamentRepository.save(t));
    }

    public TournamentDTO update(TournamentDTO tournament){
        UserDTO loggedInUser = userService.whoIsLoggedIn();

        if(tournamentService.findByName(tournament.getName()) == null){
            throw new APIException(Tournament.class,tournament.getName(), HttpStatus.NOT_FOUND);
        }else if(tournament.getOwner().getUserId() != loggedInUser.getUserId()){
            throw new APIException(Tournament.class, "Only the owner of " + tournament.getName() + " can modify it", HttpStatus.UNAUTHORIZED);
        }else if (tournament.getSport() == null){
            throw new APIException(Tournament.class, tournament.getName() + " sport is a required field", HttpStatus.BAD_REQUEST);
        }

        Sport sport = sportRepository.findByName(tournament.getSport().getName());
        User owner = userRepository.findByUserName(tournament.getOwner().getUsername());
        Tournament t = new Tournament(tournament.getDisplayName(),sport, owner);
        return convertToDto(tournamentRepository.save(t));
    }

    public void delete(TournamentDTO tournament){

        UserDTO loggedInUser = userService.whoIsLoggedIn();

        if(tournamentService.findByName(tournament.getName()) == null){
            throw new APIException(Tournament.class,tournament.getName(),HttpStatus.NOT_FOUND);
        }else if(tournament.getOwner().getUserId() != loggedInUser.getUserId()){
            throw new APIException(Tournament.class, "Only the owner of " + tournament.getName() + " can modify it", HttpStatus.UNAUTHORIZED);
        }else if (tournament.getSport() == null){
            throw new APIException(Tournament.class, tournament.getName() + " sport is a required field", HttpStatus.BAD_REQUEST);
        }

        try {
            tournamentRepository.delete(convertToEntity(tournament));
        } catch (ParseException e) {
            e.printStackTrace();
        }
    }

    public TournamentDTO findByName(String name){
        Tournament t = tournamentRepository.findByName(name);
        return t == null ? null : convertToDto(t);
    }

    public GameDTO addGameForTournament(String tournamentName, GameDTO game){


        //TODO validate data
        //TODO looser send game
        //TODO calculate point value
        //TODO might make more sense to be in POST /game ??

        TournamentDTO tournament =  tournamentService.findByName(tournamentName);
        for(OutcomeDTO o : game.getOutcomes()){
            o.setUser(userService.findByUserName(o.getUser().getUsername()));
        }

        List<OutcomeDTO> outcomes = game.getOutcomes();
        for(OutcomeDTO o : outcomes){
            UserDTO user = userService.findByUserName(o.getUser().getUsername());
            if(user == null){
                throw new APIException(this.getClass(), "User " + o.getUser().getUsername() + " doesn't exist ", HttpStatus.NOT_FOUND);
            }
            o.setUser(user);
        }

        return gameService.addGame(tournament, outcomes);
    }

    protected Tournament convertToEntity(TournamentDTO tournamentDto) throws ParseException {

       // Tournament tournament = modelMapper.map(tournamentDto, Tournament.class);

        Tournament tournament = new Tournament(tournamentDto.getDisplayName(),
                sportRepository.findByName(tournamentDto.getSport().getName()),
                userService.convertToEntity(tournamentDto.getOwner()));
        tournament.setTournamentId(tournamentDto.getTournamentId());
        tournament.setIsOver(tournamentDto.getIsOver());
        tournament.setGames(gameRepository.findByTournamentName(tournamentDto.getName(),null));

        return tournament;
    }

    protected TournamentDTO convertToDto(Tournament tournament) {
       // TournamentDTO tournamentDTO = modelMapper.map(tournament, TournamentDTO.class);

        TournamentDTO tournamentDTO = new TournamentDTO();

        tournamentDTO.setTournamentId(tournament.getTournamentId());
        tournamentDTO.setName(tournament.getName());
        tournamentDTO.setDisplayName(tournament.getDisplayName());
        tournamentDTO.setIsOver(tournament.getIsOver());
        tournamentDTO.setSport(sportService.convertToDto(tournament.getSport()));

        if (tournament.getTournamentId() != null) {
            tournamentDTO.setOwner(
                    userService.convertToDto(tournament.getOwner())
            );
        }
        return tournamentDTO;
    }
}
